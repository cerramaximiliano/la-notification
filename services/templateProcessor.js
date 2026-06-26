const { EmailTemplate } = require('../models');
const logger = require('../config/logger');
const { signMovementToken } = require('../utils/movementLinkToken');

// URL base del front para los links /m/:token (override por opts/env; default
// al dominio de prod). El FLAG de rollout NO vive acá: viene del config doc
// JudicialNotificationConfig (contentConfig.usePublicMovementLinks), pasado
// como opción por el caller → toggleable en runtime sin restart.
const DEFAULT_FRONT_BASE_URL = process.env.FRONT_BASE_URL || 'https://www.lawanalytics.app';

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

  // Generar HTML para todos los expedientes
  let expedientesHtml = '';
  let expedientesText = '';
  
  // Card por expediente (diseño onboarding: card redondeada con header tintado
  // + tabla de movimientos). Se inyecta como filas <tr> dentro de la card blanca
  // del template DB notification/judicial-movements (slot {{expedientesHtml}}).
  const expedienteTemplate = `
      <tr><td class="px-card" style="padding:16px 44px 4px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF2;border-radius:10px;overflow:hidden;">
          <tr><td style="background-color:#F8FAFC;border-bottom:1px solid #E6EAF2;padding:14px 18px;">
            <p style="margin:0 0 3px 0;font-size:11px;color:#3A7BFF;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Expediente {{numberYear}} · {{fuero}}</p>
            <p style="margin:0;font-size:14px;line-height:1.4;color:#0F172A;font-weight:600;">{{caratula}}</p>
          </td></tr>
          <tr><td style="padding:0;">
            <table class="mov-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <thead><tr style="background-color:#FFFFFF;">
                <th style="padding:9px 14px;font-size:11px;color:#64748B;text-align:left;border-bottom:1px solid #E6EAF2;text-transform:uppercase;letter-spacing:0.05em;">Fecha</th>
                <th style="padding:9px 14px;font-size:11px;color:#64748B;text-align:left;border-bottom:1px solid #E6EAF2;text-transform:uppercase;letter-spacing:0.05em;">Tipo</th>
                <th style="padding:9px 14px;font-size:11px;color:#64748B;text-align:left;border-bottom:1px solid #E6EAF2;text-transform:uppercase;letter-spacing:0.05em;">Detalle</th>
              </tr></thead>
              <tbody>{{movimientosRows}}</tbody>
            </table>
          </td></tr>
        </table>
      </td></tr>`;

  const movimientoRowTemplate = `
              <tr>
                <td class="causa-fecha" style="padding:9px 14px;font-size:13px;color:#475569;border-bottom:1px solid #EEF1F6;white-space:nowrap;">{{fecha}}</td>
                <td class="causa-tipo" style="padding:9px 14px;font-size:13px;color:#0F172A;font-weight:600;border-bottom:1px solid #EEF1F6;">{{tipo}}</td>
                <td class="causa-detalle" style="padding:9px 14px;font-size:13px;color:#475569;border-bottom:1px solid #EEF1F6;">{{detalle}}{{urlHtml}}</td>
              </tr>`;

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
        } catch (err) {
          logger.error(`No se pudo firmar el movement-link, usando URL del portal: ${err.message}`);
          docUrl = portalUrl;
        }
      }

      // HTML row
      const urlHtml = docUrl
        ? `<br><a href="${docUrl}" style="color:#3A7BFF; font-size:12px; text-decoration:none; font-weight:500;">Ver documento →</a>`
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

    // Procesar template del expediente
    expedientesHtml += processTemplate(expedienteTemplate, {
      number: expediente.number,
      year: expediente.year,
      numberYear,
      fuero: expediente.fuero,
      caratula: expediente.caratula,
      movimientosRows
    });

    // Versión texto
    expedientesText += `\nExpediente ${numberYear} - ${expediente.fuero}\n`;
    expedientesText += `Carátula: ${expediente.caratula}\n\n`;
    expedientesText += movimientosText;
  }
  
  return {
    userName: user.name || user.email || 'Usuario',
    userEmail: user.email,
    expedientesCount: Object.keys(movementsByExpediente).length,
    expedientesHtml,
    expedientesText,
    'process.env.BASE_URL': process.env.BASE_URL || ''
  };
}

// Header de sección dentro de la card blanca (eyebrow azul). Se usa para separar
// "Notificaciones" de "Movimientos" cuando el email trae ambos.
function sectionHeaderHtml(title) {
  return `
      <tr><td class="px-card" style="padding:26px 44px 2px 44px;">
        <p style="margin:0;font-size:12px;color:#3A7BFF;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">${title}</p>
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

  const expedienteTemplate = `
      <tr><td class="px-card" style="padding:16px 44px 4px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF2;border-radius:10px;overflow:hidden;">
          <tr><td style="background-color:#F8FAFC;border-bottom:1px solid #E6EAF2;padding:14px 18px;">
            <p style="margin:0 0 3px 0;font-size:11px;color:#3A7BFF;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Expediente {{numberYear}} · {{fuero}}</p>
            <p style="margin:0;font-size:14px;line-height:1.4;color:#0F172A;font-weight:600;">{{caratula}}</p>
          </td></tr>
          <tr><td style="padding:0;">
            <table class="mov-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <thead><tr style="background-color:#FFFFFF;">
                <th style="padding:9px 14px;font-size:11px;color:#64748B;text-align:left;border-bottom:1px solid #E6EAF2;text-transform:uppercase;letter-spacing:0.05em;">Fecha</th>
                <th style="padding:9px 14px;font-size:11px;color:#64748B;text-align:left;border-bottom:1px solid #E6EAF2;text-transform:uppercase;letter-spacing:0.05em;">Tipo</th>
                <th style="padding:9px 14px;font-size:11px;color:#64748B;text-align:left;border-bottom:1px solid #E6EAF2;text-transform:uppercase;letter-spacing:0.05em;">Detalle</th>
              </tr></thead>
              <tbody>{{cedulasRows}}</tbody>
            </table>
          </td></tr>
        </table>
      </td></tr>`;

  const cedulaRowTemplate = `
              <tr>
                <td style="padding:9px 14px;font-size:13px;color:#475569;border-bottom:1px solid #EEF1F6;white-space:nowrap;">{{fecha}}</td>
                <td style="padding:9px 14px;font-size:13px;color:#0F172A;font-weight:600;border-bottom:1px solid #EEF1F6;">{{tipo}}</td>
                <td style="padding:9px 14px;font-size:13px;color:#475569;border-bottom:1px solid #EEF1F6;">{{detalle}}</td>
              </tr>`;

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

  // Prepend el header de sección.
  cedulasHtml = sectionHeaderHtml('Notificaciones recibidas') + cedulasHtml;
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