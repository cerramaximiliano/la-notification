const { EmailTemplate } = require('../models');
const logger = require('../config/logger');
const { signMovementToken } = require('../utils/movementLinkToken');

// URL base del front para los links /m/:token (override por opts/env; default
// al dominio de prod). El FLAG de rollout NO vive acá: viene del config doc
// JudicialNotificationConfig (contentConfig.usePublicMovementLinks), pasado
// como opción por el caller → toggleable en runtime sin restart.
const DEFAULT_FRONT_BASE_URL = process.env.FRONT_BASE_URL || 'https://www.lawanalytics.app';

// URL base del server (para el pixel de apertura /api/public/movimientos/:token/open.gif).
const DEFAULT_SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'https://server.lawanalytics.app';

/**
 * Procesa un template reemplazando las variables con los valores proporcionados
 * @param {string} template - String del template con variables {{variable}} o ${variable}
 * @param {Object} data - Objeto con los valores para reemplazar
 * @returns {string} - Template procesado
 */
function processTemplate(template, data) {
  let processed = template;

  // Reemplazar cada variable en el template
  Object.keys(data).forEach(key => {
    // Usar ?? en lugar de || para que 0 no sea reemplazado por string vacío
    const value = data[key] ?? '';

    // Reemplazar formato {{variable}}
    const regexDoubleBraces = new RegExp(`{{${key}}}`, 'g');
    processed = processed.replace(regexDoubleBraces, value);

    // Reemplazar formato ${variable}
    // Escapamos el $ para la expresión regular
    const regexDollarBraces = new RegExp(`\\$\\{${key}\\}`, 'g');
    processed = processed.replace(regexDollarBraces, value);
  });

  return processed;
}

/**
 * Obtiene y procesa un email template de la base de datos
 * @param {string} category - Categoría del template
 * @param {string} name - Nombre del template
 * @param {Object} variables - Variables para reemplazar en el template
 * @returns {Object} - Template procesado con subject, html y text
 */
async function getProcessedTemplate(category, name, variables) {
  try {
    // Buscar template activo
    const template = await EmailTemplate.findOne({
      category,
      name,
      isActive: true
    });

    if (!template) {
      throw new Error(`Template no encontrado: ${category}/${name}`);
    }

    // Procesar subject, html y text
    const processedSubject = processTemplate(template.subject, variables);
    const processedHtml = processTemplate(template.htmlContent || template.htmlBody || '', variables);
    const processedText = processTemplate(template.textContent || template.textBody || '', variables);

    return {
      subject: processedSubject,
      html: processedHtml,
      text: processedText,
      template: template
    };
  } catch (error) {
    logger.error(`Error procesando template ${category}/${name}:`, error);
    throw error;
  }
}

/**
 * Procesa datos específicos para movimientos judiciales
 * @param {Array} movementsByExpediente - Movimientos agrupados por expediente
 * @param {Object} user - Usuario destinatario
 * @param {Object} [options] - { usePublicMovementLinks, frontBaseUrl } desde el config doc
 * @returns {Object} - Variables procesadas para el template
 */
function processJudicialMovementsData(movementsByExpediente, user, options = {}) {
  const moment = require('moment');

  // Flag de visor público + base URL: vienen del config doc (caller), con
  // fallback seguro a OFF / dominio de prod.
  const usePublicLinks = options.usePublicMovementLinks === true;
  const frontBaseUrl = options.frontBaseUrl || DEFAULT_FRONT_BASE_URL;
  // Mapa expedienteKey → folderId (resuelto por el caller) para el CTA
  // "Ver causa completa" por card. Vacío = sin CTA por card.
  const folderIdByExpediente = options.folderIdByExpediente || {};
  // Primer token firmado del email — se reusa para el pixel de apertura.
  let firstToken = null;

  // Generar HTML para todos los expedientes
  let expedientesHtml = '';
  let expedientesText = '';

  // Rediseño 2026-07 (v3): los expedientes van DENTRO de un contenedor único de
  // sección, cuya banda superior es el título ("Movimientos nuevos"). Sección y
  // contenido son un solo bloque físico — antes cada expediente era una card
  // suelta y el header de sección flotaba desconectado arriba.
  //
  // Jerarquía de tintes: banda de sección (azul suave #EFF4FF) > header de
  // expediente (gris #F8FAFC) > filas blancas.
  const sectionTitle = options.sectionTitle || 'Movimientos nuevos';
  const sectionWrapperTemplate = `
      <tr><td class="px-card" style="padding:20px 44px 4px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF2;border-radius:10px;overflow:hidden;">
          <tr><td style="background-color:#EFF4FF;padding:11px 18px;">
            <p style="margin:0;font-size:11px;color:#3A7BFF;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">{{sectionTitle}}</p>
          </td></tr>{{segments}}
        </table>
      </td></tr>`;

  // Segmento por expediente (v4): el bloque de la causa es una SUPERFICIE gris
  // continua (header + área de movimientos + CTA comparten fondo #F8FAFC) y cada
  // movimiento es una CARD blanca apoyada sobre ella — la contención hace obvia
  // la pertenencia (antes las filas de tabla parecían desvinculadas del header).
  const expedienteTemplate = `
          <tr><td style="background-color:#F8FAFC;border-top:1px solid #E6EAF2;padding:14px 18px 10px 18px;">
            <p style="margin:0 0 3px 0;font-size:11px;color:#3A7BFF;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Expediente {{numberYear}} · {{fuero}}</p>
            <p style="margin:0;font-size:14px;line-height:1.4;color:#0F172A;font-weight:600;">{{caratula}}</p>
          </td></tr>{{movimientosRows}}{{folderCtaHtml}}`;

  // Card blanca por movimiento, sobre la superficie gris de la causa.
  const movimientoRowTemplate = `
          <tr><td style="background-color:#F8FAFC;padding:0 18px 10px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E6EAF2;border-radius:8px;">
              <tr><td style="padding:12px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="font-size:13px;font-weight:600;color:#0F172A;">{{tipo}}</td>
                  <td align="right" style="font-size:12px;color:#64748B;white-space:nowrap;">{{fecha}}</td>
                </tr></table>
                <p style="margin:6px 0 0 0;font-size:13px;line-height:1.55;color:#475569;">{{detalle}}</p>{{urlHtml}}
              </td></tr>
            </table>
          </td></tr>`;

  // Footer de segmento: CTA a la causa, sobre la misma superficie gris.
  const folderCtaTemplate = `
          <tr><td style="background-color:#F8FAFC;padding:2px 18px 14px 18px;" align="right">
            <a href="{{folderUrl}}" style="font-size:13px;font-weight:600;color:#3A7BFF;text-decoration:none;">Ver causa completa en Law Analytics&nbsp;&#8594;</a>
          </td></tr>`;

  // Procesar cada expediente
  for (const [key, data] of Object.entries(movementsByExpediente)) {
    const { expediente, movements } = data;
    
    // Generar filas de movimientos
    let movimientosRows = '';
    let movimientosText = '';
    
    movements.forEach(movement => {
      const fecha = moment(movement.movimiento.fecha).format('DD/MM/YYYY');
      
      // Link "Ver documento": cuando el visor público está habilitado, apunta a
      // nuestra página /m/:token (PDF desde S3 + tracking + CTA a la app). Si el
      // flag está OFF o falla la firma, cae a la URL original del portal.
      const portalUrl = movement.movimiento.url;
      let docUrl = portalUrl;
      if (usePublicLinks && portalUrl && expediente.id) {
        try {
          const token = signMovementToken({ causaId: expediente.id, userId: movement.userId, url: portalUrl });
          docUrl = `${frontBaseUrl}/m/${token}?source=email_movimiento`;
          if (!firstToken) firstToken = token;
        } catch (err) {
          logger.error(`No se pudo firmar el movement-link, usando URL del portal: ${err.message}`);
          docUrl = portalUrl;
        }
      }

      // "Ver documento" como BOTÓN dentro de la card del movimiento (rediseño
      // 2026-07: es la puerta al visor /m/:token y era un link de 12px; ahora es
      // el elemento accionable más visible de la card).
      const urlHtml = docUrl
        ? `<p style="margin:10px 0 0 0;"><a href="${docUrl}" style="display:inline-block;padding:8px 16px;font-size:12px;font-weight:600;color:#FFFFFF;background-color:#3A7BFF;border-radius:6px;text-decoration:none;">Ver documento&nbsp;&#8594;</a></p>`
        : '';
      
      movimientosRows += processTemplate(movimientoRowTemplate, {
        fecha,
        tipo: movement.movimiento.tipo,
        detalle: movement.movimiento.detalle,
        urlHtml
      });
      
      // Text version
      movimientosText += `- ${fecha}: ${movement.movimiento.tipo} - ${movement.movimiento.detalle}\n`;
      if (docUrl) {
        movimientosText += `  Ver documento: ${docUrl}\n`;
      }
    });
    
    // Formato "number/year" cuando hay year, sólo "number" cuando no.
    // Algunas fuentes (causas SCBA con numeración vieja) no tienen year.
    const numberYear = expediente.year != null && expediente.year !== ''
      ? `${expediente.number}/${expediente.year}`
      : `${expediente.number ?? ''}`.trim() || '(sin nº)';

    // CTA por card a la causa en la app (si el caller resolvió el folder).
    const folderId = folderIdByExpediente[key];
    const folderUrl = folderId ? `${frontBaseUrl}/apps/folders/details/${folderId}` : null;
    const folderCtaHtml = folderUrl ? processTemplate(folderCtaTemplate, { folderUrl }) : '';

    // Procesar template del expediente
    expedientesHtml += processTemplate(expedienteTemplate, {
      number: expediente.number,
      year: expediente.year,
      numberYear,
      fuero: expediente.fuero,
      caratula: expediente.caratula,
      movimientosRows,
      folderCtaHtml
    });

    // Versión texto
    expedientesText += `\nExpediente ${numberYear} - ${expediente.fuero}\n`;
    expedientesText += `Carátula: ${expediente.caratula}\n\n`;
    expedientesText += movimientosText;
    if (folderUrl) {
      expedientesText += `Ver causa completa: ${folderUrl}\n`;
    }
  }

  // Envolver los segmentos en el contenedor de sección (banda de título arriba).
  if (expedientesHtml) {
    expedientesHtml = processTemplate(sectionWrapperTemplate, { sectionTitle, segments: expedientesHtml });
  }

  // Pixel de apertura: reusa el primer token firmado del email (atribuye
  // user+causa). Sin visor público habilitado no hay token → sin pixel.
  const trackingPixelHtml = firstToken
    ? `<img src="${DEFAULT_SERVER_BASE_URL}/api/public/movimientos/${firstToken}/open.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`
    : '';

  return {
    userName: user.name || user.email || 'Usuario',
    userEmail: user.email,
    expedientesCount: Object.keys(movementsByExpediente).length,
    expedientesHtml,
    expedientesText,
    trackingPixelHtml,
    'process.env.BASE_URL': process.env.BASE_URL || ''
  };
}

// Header de sección dentro de la card blanca: divisor + eyebrow azul. Ancla
// visualmente las cards de expedientes al hero (antes flotaban sin conexión) y
// separa "Notificaciones" de "Movimientos" cuando el email trae ambos.
function sectionHeaderHtml(title) {
  return `
      <tr><td class="px-card" style="padding:24px 44px 0 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="border-top:1px solid #E6EAF2;padding-top:18px;">
            <p style="margin:0;font-size:12px;color:#3A7BFF;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">${title}</p>
          </td></tr>
        </table>
      </td></tr>`;
}

/**
 * Procesa las cédulas (notificaciones) agrupadas por expediente para el slot
 * {{cedulasHtml}}. Mismo diseño de card que los movimientos. Incluye su propio
 * header de sección "Notificaciones recibidas".
 * @param {Object} cedulasByExpediente - { [expedienteId]: { expediente, cedulas: [] } }
 * @returns {Object} { cedulasHtml, cedulasText, cedulasExpedienteKeys }
 */
function processJudicialCedulasData(cedulasByExpediente) {
  const moment = require('moment');

  // Mismo patrón de contenedor único que los movimientos (v3): banda de sección
  // + segmentos por expediente adentro.
  const sectionWrapperTemplate = `
      <tr><td class="px-card" style="padding:20px 44px 4px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF2;border-radius:10px;overflow:hidden;">
          <tr><td style="background-color:#EFF4FF;padding:11px 18px;">
            <p style="margin:0;font-size:11px;color:#3A7BFF;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">Notificaciones recibidas</p>
          </td></tr>{{segments}}
        </table>
      </td></tr>`;

  // Mismo patrón v4 que los movimientos: superficie gris por expediente + card
  // blanca por cédula.
  const expedienteTemplate = `
          <tr><td style="background-color:#F8FAFC;border-top:1px solid #E6EAF2;padding:14px 18px 10px 18px;">
            <p style="margin:0 0 3px 0;font-size:11px;color:#3A7BFF;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Expediente {{numberYear}} · {{fuero}}</p>
            <p style="margin:0;font-size:14px;line-height:1.4;color:#0F172A;font-weight:600;">{{caratula}}</p>
          </td></tr>{{cedulasRows}}
          <tr><td style="background-color:#F8FAFC;padding:0 18px 6px 18px;"></td></tr>`;

  const cedulaRowTemplate = `
          <tr><td style="background-color:#F8FAFC;padding:0 18px 10px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E6EAF2;border-radius:8px;">
              <tr><td style="padding:12px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="font-size:13px;font-weight:600;color:#0F172A;">{{tipo}}</td>
                  <td align="right" style="font-size:12px;color:#64748B;white-space:nowrap;">{{fecha}}</td>
                </tr></table>
                <p style="margin:6px 0 0 0;font-size:13px;line-height:1.55;color:#475569;">{{detalle}}</p>
              </td></tr>
            </table>
          </td></tr>`;

  let cedulasHtml = '';
  let cedulasText = '';
  const keys = Object.keys(cedulasByExpediente);

  if (keys.length === 0) {
    return { cedulasHtml: '', cedulasText: '', cedulasExpedienteKeys: [] };
  }

  for (const [, data] of Object.entries(cedulasByExpediente)) {
    const { expediente, cedulas } = data;

    let cedulasRows = '';
    cedulas.forEach(c => {
      const fecha = c.cedula && c.cedula.fecha ? moment(c.cedula.fecha).format('DD/MM/YYYY') : '';
      const tipo = (c.cedula && c.cedula.tipo) || 'Cédula';
      // Detalle compuesto: N° de cédula + oficina emisora (lo más útil para el lector).
      const partes = [];
      if (c.cedula && c.cedula.numeroCedula) partes.push(`N° ${c.cedula.numeroCedula}`);
      if (c.cedula && c.cedula.oficina) partes.push(c.cedula.oficina);
      const detalle = partes.join(' — ') || 'Cédula recibida';

      cedulasRows += processTemplate(cedulaRowTemplate, { fecha, tipo, detalle });
      cedulasText += `- ${fecha}: ${tipo} - ${detalle}\n`;
    });

    const numberYear = expediente.year != null && expediente.year !== ''
      ? `${expediente.number}/${expediente.year}`
      : `${expediente.number ?? ''}`.trim() || '(sin nº)';

    cedulasHtml += processTemplate(expedienteTemplate, {
      numberYear,
      fuero: expediente.fuero,
      caratula: expediente.caratula,
      cedulasRows
    });

    cedulasText += `\nExpediente ${numberYear} - ${expediente.fuero}\n`;
    cedulasText += `Carátula: ${expediente.caratula}\n\n`;
  }

  // Envolver los segmentos en el contenedor de sección (banda de título arriba).
  cedulasHtml = processTemplate(sectionWrapperTemplate, { segments: cedulasHtml });
  cedulasText = `NOTIFICACIONES RECIBIDAS\n${cedulasText}`;

  return { cedulasHtml, cedulasText, cedulasExpedienteKeys: keys };
}

module.exports = {
  processTemplate,
  getProcessedTemplate,
  processJudicialMovementsData,
  processJudicialCedulasData,
  sectionHeaderHtml
};