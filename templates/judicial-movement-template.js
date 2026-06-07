// Template para notificaciones de movimientos judiciales.
// Diseño: formato campañas onboarding (espejo de scba-workers / pjn-mis-causas):
// fondo gris, header bar (logo + etiqueta), card blanca redondeada, eyebrow+H1+lede,
// una card por expediente con tabla de movimientos, CTA azul, soporte + footer afuera.
//
// htmlContent es el DOCUMENTO COMPLETO que se renderiza (la-notification es DB-only:
// el envío usa el htmlContent del doc en `emailtemplates`). El slot {{expedientesHtml}}
// lo arma `services/templateProcessor.js` (processJudicialMovementsData) con el mismo
// diseño (cards por expediente). Re-seed: scripts/seed-judicial-movements-template.js.
module.exports = {
  category: 'notification',
  name: 'judicial-movements',
  subject: 'Law||Analytics: Nuevos movimientos en {{expedientesCount}} expediente(s)',
  preheader: 'Se registraron nuevos movimientos en tus expedientes',
  description: 'Template para notificar movimientos judiciales a usuarios (diseño onboarding)',
  tags: ['judicial', 'movements', 'notifications', 'legal'],
  variables: [
    'userName',
    'userEmail',
    'expedientesCount',
    'expedientesHtml',
    'expedientesText'
  ],
  htmlContent: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<meta name="color-scheme" content="light only"/>
<title>Law||Analytics</title>
<style type="text/css">
    html, body { margin:0 !important; padding:0 !important; }
    * { -ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt !important; mso-table-rspace:0pt !important; border-collapse:collapse !important; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; max-width:100%; }
    a { text-decoration:none; }
    body { font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Helvetica, Arial, sans-serif; background-color:#F4F5F7; color:#0F172A; }
    .cta:hover { background-color:#2D63E0 !important; }
    .text-link:hover { color:#2D63E0 !important; }
    @media only screen and (max-width:600px) {
      .wrap { width:100% !important; }
      .px-outer { padding-left:20px !important; padding-right:20px !important; }
      .px-card { padding:24px !important; }
      .h1-display { font-size:26px !important; line-height:1.2 !important; letter-spacing:-0.4px !important; }
      .cta-wrap, .cta-wrap td { width:100% !important; }
      .cta { display:block !important; width:100% !important; text-align:center !important; }
      .footer-link { display:block !important; padding:6px 0 !important; }
      .footer-sep { display:none !important; }
      .mov-table thead { display:none !important; }
      .mov-table, .mov-table tbody, .mov-table tr, .mov-table td { display:block !important; width:100% !important; }
      .mov-table tr { border-bottom:1px solid #EEF1F6 !important; padding:8px 0 !important; }
      .mov-table td { border:0 !important; padding:2px 0 !important; }
    }
</style></head>
<body style="margin:0;padding:0;background-color:#F4F5F7;color:#0F172A;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#F4F5F7;">Se registraron nuevos movimientos en tus expedientes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F7;"><tr>
<td align="center" style="padding:40px 16px 64px 16px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
  <tr><td class="px-outer" style="padding:0 16px 28px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="vertical-align:middle;"><img src="https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png" width="148" height="auto" alt="Law||Analytics" style="display:block;max-width:148px;height:auto;border:0;"/></td>
      <td align="right" style="vertical-align:middle;font-size:12px;color:#3A7BFF;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Movimientos judiciales</td>
    </tr></table>
  </td></tr>
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border-radius:14px;box-shadow:0 1px 0 rgba(58,123,255,0.04),0 12px 32px -16px rgba(15,23,42,0.12);">
      <tr><td class="px-card" style="padding:40px 44px 8px 44px;">
        <p style="margin:0 0 16px 0;font-size:11px;color:#3A7BFF;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;">Novedades en tus causas</p>
        <h1 class="h1-display" style="margin:0 0 16px 0;font-size:30px;line-height:1.16;letter-spacing:-0.5px;font-weight:600;color:#0F172A;">Tenés nuevos movimientos</h1>
        <p style="margin:0;font-size:16px;line-height:1.6;color:#334155;">Hola {{userName}}, se registraron movimientos nuevos en {{expedientesCount}} expediente(s). Acá tenés el detalle.</p>
      </td></tr>
{{expedientesHtml}}
      <tr><td class="px-card" style="padding:20px 44px 12px 44px;">
        <table role="presentation" class="cta-wrap" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="#3A7BFF" style="border-radius:8px;box-shadow:0 6px 20px -8px rgba(58,123,255,0.55);">
            <a class="cta" href="https://www.lawanalytics.app/apps/folders/list" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:-0.1px;border-radius:8px;">Ver mis causas&nbsp;&#8594;</a>
          </td></tr></table>
      </td></tr>
      <tr><td class="px-card" style="padding:6px 44px 6px 44px;"><p style="margin:0;font-size:13px;line-height:1.6;color:#64748B;">Podés ver el detalle completo de cada movimiento en la sección de causas de tu cuenta. Esta notificación se envía cuando detectamos actividad nueva en tus expedientes.</p></td></tr>
      <tr><td class="px-card" style="padding:0 44px 36px 44px;"></td></tr>
    </table>
  </td></tr>
  <tr><td class="px-outer" style="padding:28px 24px 0 24px;">
    <p style="margin:0;font-size:13px;line-height:1.55;color:#64748B;text-align:center;">¿Necesitás ayuda? Escribinos a <a class="text-link" href="mailto:soporte@lawanalytics.app" style="color:#3A7BFF;text-decoration:none;font-weight:500;">soporte@lawanalytics.app</a> — respondemos personas, no bots.</p>
  </td></tr>
  <tr><td class="px-outer" style="padding:24px 24px 8px 24px;">
    <p style="margin:0 0 8px 0;font-size:12px;color:#94A3B8;text-align:center;letter-spacing:0.02em;">&copy; ${new Date().getFullYear()} Law||Analytics &middot; Plataforma de gestión jurídica</p>
    <p style="margin:0;font-size:12px;color:#94A3B8;text-align:center;">
      <a class="footer-link" href="https://www.lawanalytics.app/privacy-policy" style="color:#94A3B8;text-decoration:none;">Privacidad</a>
      <span class="footer-sep" style="color:#CBD5E1;">&nbsp;&middot;&nbsp;</span>
      <a class="footer-link" href="https://www.lawanalytics.app/terms" style="color:#94A3B8;text-decoration:none;">Términos</a>
    </p>
  </td></tr>
</table></td></tr></table></body></html>`,

  textContent: `Nuevos movimientos judiciales

Hola {{userName}},

Se registraron nuevos movimientos en {{expedientesCount}} de tus expedientes:

{{expedientesText}}

Ver el detalle completo en: https://www.lawanalytics.app/apps/folders/list

Saludos,
El equipo de Law||Analytics`,

  // Parciales de referencia (la generación real vive en
  // services/templateProcessor.js → processJudicialMovementsData, mismo diseño).
  expedienteHtmlTemplate: `
      <tr><td class="px-card" style="padding:16px 44px 4px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF2;border-radius:10px;overflow:hidden;">
          <tr><td style="background-color:#F8FAFC;border-bottom:1px solid #E6EAF2;padding:14px 18px;">
            <p style="margin:0 0 3px 0;font-size:11px;color:#3A7BFF;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Expediente {{number}}/{{year}} &middot; {{fuero}}</p>
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
      </td></tr>`,

  movimientoRowTemplate: `
              <tr>
                <td style="padding:9px 14px;font-size:13px;color:#475569;border-bottom:1px solid #EEF1F6;white-space:nowrap;">{{fecha}}</td>
                <td style="padding:9px 14px;font-size:13px;color:#0F172A;font-weight:600;border-bottom:1px solid #EEF1F6;">{{tipo}}</td>
                <td style="padding:9px 14px;font-size:13px;color:#475569;border-bottom:1px solid #EEF1F6;">{{detalle}}{{urlHtml}}</td>
              </tr>`,

  expedienteTextTemplate: `
Expediente {{number}}/{{year}} - {{fuero}}
Carátula: {{caratula}}

{{movimientosText}}`,

  metadata: {
    version: '2.0',
    requiredModels: ['JudicialMovement', 'User']
  }
};
