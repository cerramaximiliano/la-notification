/**
 * Procesador del email de seguimiento postal.
 *
 * Mismo lenguaje visual que el resto de las notificaciones (cards blancas
 * sobre superficie gris, pills de estado, banda de sección azul). El HTML
 * de las cards lo genera este módulo; el shell viene del template
 * `notification/postal-tracking-update` de la base — con FALLBACK a un
 * shell completo en código si el template no existe o falla la lectura.
 */

const moment = require('moment-timezone');

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_FRONT_BASE_URL = 'https://www.lawanalytics.app';

/** Escapa texto que viene del scraping (nunca interpolar crudo en el HTML). */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pill(text, bg, color, border) {
  return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;background-color:${bg};color:${color};border:1px solid ${border};">${esc(text)}</span>`;
}

/** Pill del estado de entrega: verde si entregado, ámbar si en curso. */
function deliveryPill(deliveryStatus) {
  if (!deliveryStatus) return '';
  const entregado = /entregad|finaliz/i.test(String(deliveryStatus));
  return entregado
    ? pill(deliveryStatus, '#ECFDF5', '#059669', '#6EE7B7')
    : pill(deliveryStatus, '#EFF4FF', '#3A7BFF', '#C7D8FF');
}

function formatEventDate(date) {
  if (!date) return '';
  return moment(date).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
}

/**
 * Variables del template para un envío postal.
 *
 * @param {Object} notification - doc PostalNotification (o equivalente)
 * @param {Object} user
 * @param {Object} [options] - { frontBaseUrl }
 */
function processPostalData(notification, user, options = {}) {
  const frontBase = options.frontBaseUrl || process.env.FRONT_BASE_URL || DEFAULT_FRONT_BASE_URL;
  const tracking = notification.tracking || {};
  const events = Array.isArray(notification.events) ? notification.events : [];

  const codigo = [tracking.codeId, tracking.numberId].filter(Boolean).join(' ').trim() || '(sin código)';

  // Card blanca por evento, sobre la superficie gris de la sección.
  let eventosHtml = '';
  let eventosText = '';

  events.forEach((ev) => {
    const fecha = formatEventDate(ev.eventDate);
    const estado = esc(ev.status || 'Actualización');
    const ubicacion = ev.location ? esc(ev.location) : '';
    const detalle = ev.description ? esc(ev.description) : '';

    eventosHtml += `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E6EAF2;border-radius:8px;margin-bottom:10px;">
        <tr><td style="padding:12px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:13px;font-weight:600;color:#0F172A;">${estado}</td>
            <td align="right" style="font-size:12px;color:#64748B;white-space:nowrap;">${fecha}</td>
          </tr></table>
          ${detalle ? `<p style="margin:6px 0 0 0;font-size:13px;line-height:1.55;color:#475569;">${detalle}</p>` : ''}
          ${ubicacion || ev.deliveryStatus ? `<p style="margin:8px 0 0 0;">${ev.deliveryStatus ? deliveryPill(ev.deliveryStatus) : ''}${ubicacion ? ` <span style="font-size:12px;color:#64748B;">📍 ${ubicacion}</span>` : ''}</p>` : ''}
        </td></tr>
      </table>`;

    eventosText += `- ${fecha}: ${ev.status || 'Actualización'}`;
    if (ev.deliveryStatus) eventosText += ` [${ev.deliveryStatus}]`;
    if (ev.location) eventosText += ` — ${ev.location}`;
    eventosText += '\n';
    if (ev.description) eventosText += `  ${ev.description}\n`;
  });

  // Contenedor de sección con banda de título (igual que movimientos).
  const sectionTitle = events.length === 1 ? 'Nueva novedad del envío' : 'Novedades del envío';
  const eventosSectionHtml = eventosHtml
    ? `
      <tr><td class="px-card" style="padding:12px 44px 4px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF2;border-radius:10px;overflow:hidden;">
          <tr><td style="background-color:#EFF4FF;padding:11px 18px;">
            <p style="margin:0;font-size:11px;color:#3A7BFF;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">${sectionTitle}</p>
          </td></tr>
          <tr><td style="background-color:#F8FAFC;border-top:1px solid #E6EAF2;padding:14px 18px 8px 18px;">
            <p style="margin:0 0 10px 0;font-size:12px;color:#64748B;">Envío <span style="font-family:monospace;background-color:#EEF2F7;padding:2px 6px;border-radius:4px;color:#0F172A;">${esc(codigo)}</span>${tracking.folderName ? ` &nbsp;·&nbsp; Carpeta: <b>${esc(tracking.folderName)}</b>` : ''}</p>
            ${eventosHtml}
          </td></tr>
        </table>
      </td></tr>`
    : '';

  // Aviso de estado definitivo
  const finalHtml = tracking.isFinalStatus
    ? `
      <tr><td class="px-card" style="padding:4px 44px 0 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ECFDF5;border:1px solid #6EE7B7;border-radius:8px;">
          <tr><td style="padding:12px 16px;">
            <p style="margin:0;font-size:13px;color:#065F46;font-weight:600;">✓ El envío alcanzó su estado definitivo.</p>
          </td></tr>
        </table>
      </td></tr>`
    : '';

  const ctaUrl = tracking.folderId
    ? `${frontBase}/apps/folders/details/${tracking.folderId}?source=email_postal_cta`
    : `${frontBase}/herramientas/seguimiento-postal?source=email_postal_cta`;
  const ctaLabel = tracking.folderId ? 'Ver la causa completa' : 'Ver mis seguimientos';

  const cantidad = events.length;
  const novedades = cantidad === 1 ? 'una novedad' : `${cantidad} novedades`;

  return {
    userName: user.name || user.email || 'Usuario',
    userEmail: user.email,
    trackingCode: codigo,
    eventsCount: cantidad,
    tituloPrincipal: 'Novedades en tu seguimiento postal',
    ledeText: `registramos ${novedades} en el envío ${codigo}. Acá tenés el detalle.`,
    eventosHtml: eventosSectionHtml,
    eventosText,
    finalStatusHtml: finalHtml,
    ctaUrl,
    ctaLabel,
    'process.env.BASE_URL': frontBase
  };
}

/**
 * Shell completo de FALLBACK (si el template de la base no está disponible).
 * Mantiene el mismo diseño; los slots de banners se reciben ya resueltos.
 */
function buildFallbackHtml(vars, bannerVars = {}) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>Law||Analytics</title>
<style type="text/css">
html, body { margin:0 !important; padding:0 !important; }
table, td { mso-table-lspace:0pt !important; mso-table-rspace:0pt !important; border-collapse:collapse !important; }
img { border:0; outline:none; text-decoration:none; max-width:100%; }
a { text-decoration:none; }
body { font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Helvetica, Arial, sans-serif; }
@media only screen and (max-width:600px) {
  .wrap { width:100% !important; }
  .px-outer { padding-left:20px !important; padding-right:20px !important; }
  .px-card { padding-left:24px !important; padding-right:24px !important; }
  .h1-display { font-size:27px !important; }
}
</style>
</head>
<body style="margin:0; padding:0; background-color:#F4F5F7; color:#0F172A;">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F4F5F7;">Novedades en el seguimiento de tu envío postal.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F7;">
<tr><td class="px-outer" align="center" style="padding:32px 24px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
  <tr><td style="padding:0 0 18px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="vertical-align:middle;"><img src="https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png" width="148" height="auto" alt="Law||Analytics" style="display:block;max-width:148px;height:auto;border:0;"/></td>
      <td align="right" style="vertical-align:middle;font-size:12px;color:#3A7BFF;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Seguimiento postal</td>
    </tr></table>
  </td></tr>
  <tr><td style="background-color:#FFFFFF; border:1px solid #E6EAF2; border-radius:14px; overflow:hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px-card" style="padding:36px 44px 8px 44px;">
        <h1 class="h1-display" style="margin:0 0 18px 0; font-size:30px; line-height:1.16; letter-spacing:-0.5px; font-weight:600; color:#0F172A;">${vars.tituloPrincipal}</h1>
        <p style="margin:0 0 6px 0; font-size:16px; line-height:1.6; color:#334155;">Hola ${esc(vars.userName)},</p>
        <p style="margin:0 0 8px 0; font-size:16px; line-height:1.6; color:#334155;">${vars.ledeText}</p>
      </td></tr>
      ${vars.eventosHtml}
      ${vars.finalStatusHtml}
      <tr><td class="px-card" style="padding:20px 44px 12px 44px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="#3A7BFF" style="border-radius:8px;box-shadow:0 6px 20px -8px rgba(58,123,255,0.55);">
            <a href="${vars.ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:-0.1px;border-radius:8px;">${vars.ctaLabel}&nbsp;&#8594;</a>
          </td>
        </tr></table>
      </td></tr>${bannerVars.planBannerHtml || ''}${bannerVars.featureBannerHtml || ''}${bannerVars.optionsBannerHtml || ''}
      <tr><td class="px-card" style="padding:6px 44px 6px 44px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748B;">Seguimos este envío automáticamente y te avisamos ante cada novedad del Correo Argentino.</p>
      </td></tr>
      <tr><td class="px-card" style="padding:14px 44px 32px 44px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748B;">Saludos,<br/>El equipo de Law||Analytics</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:22px 12px 0 12px;">
    <p style="margin:0 0 8px 0; font-size:12px; color:#94A3B8; text-align:center; letter-spacing:0.02em;">© 2026 Law||Analytics · Plataforma argentina de gestión jurídica</p>
    <p style="margin:0; font-size:12px; color:#94A3B8; text-align:center;"><a href="${vars['process.env.BASE_URL']}/privacy-policy" style="color:#94A3B8; text-decoration:none;">Privacidad</a> <span style="color:#CBD5E1;">&nbsp;·&nbsp;</span> <a href="${vars['process.env.BASE_URL']}/terms" style="color:#94A3B8; text-decoration:none;">Términos</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildFallbackText(vars, bannerVars = {}) {
  return `Hola ${vars.userName},

${vars.ledeText}

${vars.eventosText}
${vars.ctaLabel}: ${vars.ctaUrl}
${bannerVars.planBannerText || ''}${bannerVars.featureBannerText || ''}${bannerVars.optionsBannerText || ''}
Saludos,
El equipo de Law||Analytics`;
}

module.exports = {
  processPostalData,
  buildFallbackHtml,
  buildFallbackText,
  esc
};
