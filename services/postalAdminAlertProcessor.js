/**
 * Procesador del email de ALERTA OPERATIVA de seguimiento postal (al admin).
 *
 * Lo dispara postal-tracking-service vía webhook cuando detecta seguimientos
 * activos que el worker no consulta hace más de N horas (pipeline roto), y
 * de nuevo cuando la condición se normaliza.
 *
 * Mismo lenguaje visual que el resto de las notificaciones (cards blancas
 * sobre superficie gris, pills, banda de sección) pero en clave operativa:
 * banda roja para la alerta, verde para la recuperación. El shell viene del
 * template `notification/postal-admin-alert` de la base — con FALLBACK a un
 * shell completo en código si el template no existe o falla la lectura.
 */

const moment = require('moment-timezone');

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_DASHBOARD_URL = 'https://dashboard.lawanalytics.app/admin/postal-tracking';

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtArt(date) {
  if (!date) return 'nunca';
  return moment(date).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
}

function statusPill(processingStatus) {
  const activo = processingStatus === 'active';
  const bg = activo ? '#EFF4FF' : '#FEF9C3';
  const color = activo ? '#3A7BFF' : '#A16207';
  const border = activo ? '#C7D8FF' : '#FDE68A';
  const label = activo ? 'Activo' : 'Pendiente';
  return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;background-color:${bg};color:${color};border:1px solid ${border};">${label}</span>`;
}

/**
 * Variables del template para la alerta admin.
 *
 * @param {Object} alert - { kind: 'stale'|'recovered', staleAfterHours, trackings, activeSince }
 * @param {Object} [options] - { dashboardUrl }
 */
function processPostalAdminAlertData(alert, options = {}) {
  const dashboardUrl = options.dashboardUrl || process.env.ADMIN_DASHBOARD_POSTAL_URL || DEFAULT_DASHBOARD_URL;
  const kind = alert.kind === 'recovered' ? 'recovered' : 'stale';
  const staleAfterHours = alert.staleAfterHours ?? 24;
  const trackings = Array.isArray(alert.trackings) ? alert.trackings : [];
  const n = trackings.length;

  // ── Cards por seguimiento afectado ─────────────────────────────────────────
  let trackingsCardsHtml = '';
  let trackingsText = '';
  trackings.forEach((t) => {
    const codigo = [t.codeId, t.numberId].filter(Boolean).join(' ').trim() || '(sin código)';
    trackingsCardsHtml += `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E6EAF2;border-radius:8px;margin-bottom:10px;">
        <tr><td style="padding:12px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:13px;font-weight:600;color:#0F172A;"><span style="font-family:monospace;background-color:#EEF2F7;padding:2px 6px;border-radius:4px;">${esc(codigo)}</span>&nbsp; ${statusPill(t.processingStatus)}</td>
            <td align="right" style="font-size:12px;color:#B91C1C;white-space:nowrap;font-weight:600;">Última consulta: ${esc(fmtArt(t.lastCheckedAt))}</td>
          </tr></table>
          ${t.trackingStatus ? `<p style="margin:6px 0 0 0;font-size:13px;line-height:1.55;color:#475569;">Último estado del Correo: <b>${esc(t.trackingStatus)}</b></p>` : ''}
        </td></tr>
      </table>`;
    trackingsText += `- ${codigo} (${t.processingStatus}) — última consulta: ${fmtArt(t.lastCheckedAt)}`;
    if (t.trackingStatus) trackingsText += ` — estado: ${t.trackingStatus}`;
    trackingsText += '\n';
  });

  // ── Sección con banda de título ────────────────────────────────────────────
  const trackingsSectionHtml = trackingsCardsHtml
    ? `
      <tr><td class="px-card" style="padding:12px 44px 4px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF2;border-radius:10px;overflow:hidden;">
          <tr><td style="background-color:#FEF2F2;padding:11px 18px;">
            <p style="margin:0;font-size:11px;color:#B91C1C;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">Seguimientos afectados (${n})</p>
          </td></tr>
          <tr><td style="background-color:#F8FAFC;border-top:1px solid #E6EAF2;padding:14px 18px 8px 18px;">
            ${trackingsCardsHtml}
          </td></tr>
        </table>
      </td></tr>`
    : '';

  // ── Card de estado (roja en alerta, verde en recuperación) ────────────────
  const statusCardHtml =
    kind === 'stale'
      ? `
      <tr><td class="px-card" style="padding:4px 44px 0 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;">
          <tr><td style="padding:12px 16px;">
            <p style="margin:0;font-size:13px;color:#B91C1C;font-weight:600;">&#9888; El worker no consulta estos seguimientos hace más de ${staleAfterHours} horas.</p>
            <p style="margin:6px 0 0 0;font-size:12px;line-height:1.6;color:#7F1D1D;">Posibles causas: scraper-worker en crash-loop, cola trabada o caída sostenida del sitio del Correo. Revisar <span style="font-family:monospace;background-color:#FEE2E2;padding:1px 5px;border-radius:4px;">pm2 logs postal-manager</span> y los logs de <span style="font-family:monospace;background-color:#FEE2E2;padding:1px 5px;border-radius:4px;">scraper-worker-*</span> en worker_01.</p>
          </td></tr>
        </table>
      </td></tr>`
      : `
      <tr><td class="px-card" style="padding:4px 44px 0 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ECFDF5;border:1px solid #6EE7B7;border-radius:8px;">
          <tr><td style="padding:12px 16px;">
            <p style="margin:0;font-size:13px;color:#065F46;font-weight:600;">&#10003; Todos los seguimientos activos volvieron a consultarse con normalidad.</p>
            ${alert.activeSince ? `<p style="margin:6px 0 0 0;font-size:12px;line-height:1.6;color:#047857;">La condición de alerta estaba activa desde el ${esc(fmtArt(alert.activeSince))}.</p>` : ''}
          </td></tr>
        </table>
      </td></tr>`;

  const tituloPrincipal =
    kind === 'stale' ? 'Seguimientos postales sin actualizar' : 'Seguimiento postal normalizado';
  const ledeText =
    kind === 'stale'
      ? `el pipeline de scraping postal dejó de actualizar ${n === 1 ? 'un seguimiento activo' : `${n} seguimientos activos`}. Este es el detalle detectado por el manager.`
      : 'la condición de alerta del seguimiento postal se resolvió: el worker volvió a consultar todas las piezas dentro de la ventana esperada.';

  const subjectText =
    kind === 'stale'
      ? `[Postal] ALERTA: ${n} seguimiento${n === 1 ? '' : 's'} sin actualizar hace más de ${staleAfterHours}h`
      : '[Postal] Recuperado: los seguimientos vuelven a actualizarse';

  return {
    tituloPrincipal,
    ledeText,
    subjectText,
    alertKind: kind,
    staleCount: n,
    staleAfterHours,
    statusCardHtml,
    trackingsHtml: trackingsSectionHtml,
    trackingsText,
    ctaUrl: `${dashboardUrl}?source=email_postal_admin_alert`,
    ctaLabel: 'Ver en el dashboard admin',
    'process.env.BASE_URL': 'https://www.lawanalytics.app'
  };
}

// ─── Fallback en código (shell completo, mismo diseño que el template) ────────

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
table, td { border-collapse:collapse !important; }
img { border:0; max-width:100%; }
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
<div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#F4F5F7;">Alerta operativa del seguimiento postal.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F7;">
<tr><td class="px-outer" align="center" style="padding:32px 24px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
  <tr><td style="padding:0 0 18px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="vertical-align:middle;"><img src="https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png" width="148" height="auto" alt="Law||Analytics" style="display:block;max-width:148px;height:auto;border:0;"/></td>
      <td align="right" style="vertical-align:middle;font-size:12px;color:${vars.alertKind === 'stale' ? '#B91C1C' : '#059669'};letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Alerta operativa</td>
    </tr></table>
  </td></tr>
  <tr><td style="background-color:#FFFFFF; border:1px solid #E6EAF2; border-radius:14px; overflow:hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px-card" style="padding:36px 44px 8px 44px;">
        <h1 class="h1-display" style="margin:0 0 18px 0; font-size:30px; line-height:1.16; letter-spacing:-0.5px; font-weight:600; color:#0F172A;">${vars.tituloPrincipal}</h1>
        <p style="margin:0 0 6px 0; font-size:16px; line-height:1.6; color:#334155;">Hola,</p>
        <p style="margin:0 0 8px 0; font-size:16px; line-height:1.6; color:#334155;">${vars.ledeText}</p>
      </td></tr>
      ${vars.statusCardHtml}
      ${vars.trackingsHtml}
      <tr><td class="px-card" style="padding:20px 44px 12px 44px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="#3A7BFF" style="border-radius:8px;box-shadow:0 6px 20px -8px rgba(58,123,255,0.55);">
            <a href="${vars.ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:-0.1px;border-radius:8px;">${vars.ctaLabel}&nbsp;&#8594;</a>
          </td>
        </tr></table>
      </td></tr>${bannerVars.planBannerHtml || ''}${bannerVars.featureBannerHtml || ''}${bannerVars.optionsBannerHtml || ''}
      <tr><td class="px-card" style="padding:6px 44px 6px 44px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748B;">Esta alerta la genera el manager de postal-tracking-service cuando el pipeline de scraping deja de actualizar seguimientos activos. Se reenvía mientras la condición persista y avisa al normalizarse.</p>
      </td></tr>
      <tr><td class="px-card" style="padding:14px 44px 32px 44px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748B;">Saludos,<br/>El equipo de Law||Analytics</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:22px 12px 0 12px;">
    <p style="margin:0; font-size:12px; color:#94A3B8; text-align:center; letter-spacing:0.02em;">© 2026 Law||Analytics · Alerta operativa interna</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildFallbackText(vars, bannerVars = {}) {
  return `${vars.tituloPrincipal}

${vars.ledeText}

${vars.trackingsText || ''}
${vars.ctaLabel}: ${vars.ctaUrl}
${bannerVars.planBannerText || ''}${bannerVars.featureBannerText || ''}${bannerVars.optionsBannerText || ''}
Esta alerta la genera el manager de postal-tracking-service.

Saludos,
El equipo de Law||Analytics`;
}

module.exports = { processPostalAdminAlertData, buildFallbackHtml, buildFallbackText };
