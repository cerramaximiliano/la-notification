/**
 * Rediseño de los templates folder-caducity y folder-prescription al lenguaje
 * visual unificado (mismo shell que judicial-movements/calendar-events:
 * hero + contenedor de sección con banda azul + cards blancas + CTA + banners).
 *
 * CORRER DESPUÉS de deployar el código que pasa planBannerHtml/featureBannerHtml
 * (si no, los slots quedarían como texto literal en los emails).
 *
 * Idempotente: escribe subject/htmlContent/htmlBody/textContent/textBody
 * completos en cada corrida. Uso: node scripts/redesign-inactivity-templates.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

function buildShell({ preheader, eyebrow, titulo, lede, sectionTitle, ctaLabel, ctaPath, footerNote }) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
<meta charset="utf-8" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
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
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F4F5F7;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F7;">
<tr><td class="px-outer" align="center" style="padding:32px 24px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
  <tr><td style="padding:0 0 18px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="vertical-align:middle;"><img src="https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png" width="148" height="auto" alt="Law||Analytics" style="display:block;max-width:148px;height:auto;border:0;"/></td>
      <td align="right" style="vertical-align:middle;font-size:12px;color:#3A7BFF;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">${eyebrow}</td>
    </tr></table>
  </td></tr>
  <tr><td style="background-color:#FFFFFF; border:1px solid #E6EAF2; border-radius:14px; overflow:hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px-card" style="padding:36px 44px 8px 44px;">
        <h1 class="h1-display" style="margin:0 0 18px 0; font-size:30px; line-height:1.16; letter-spacing:-0.5px; font-weight:600; color:#0F172A;">${titulo}</h1>
        <p style="margin:0 0 6px 0; font-size:16px; line-height:1.6; color:#334155;">Hola {{userName}},</p>
        <p style="margin:0 0 8px 0; font-size:16px; line-height:1.6; color:#334155;">${lede}</p>
      </td></tr>
      <tr><td class="px-card" style="padding:12px 44px 4px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF2;border-radius:10px;overflow:hidden;">
          <tr><td style="background-color:#EFF4FF;padding:11px 18px;">
            <p style="margin:0;font-size:11px;color:#3A7BFF;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">${sectionTitle}</p>
          </td></tr>
          <tr><td style="background-color:#F8FAFC;border-top:1px solid #E6EAF2;padding:14px 14px 4px 14px;">{{foldersTableHtml}}</td></tr>
        </table>
      </td></tr>
      <tr><td class="px-card" style="padding:20px 44px 12px 44px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="#3A7BFF" style="border-radius:8px;box-shadow:0 6px 20px -8px rgba(58,123,255,0.55);">
            <a href="{{process.env.BASE_URL}}${ctaPath}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:-0.1px;border-radius:8px;">${ctaLabel}&nbsp;&#8594;</a>
          </td>
        </tr></table>
      </td></tr>{{planBannerHtml}}{{featureBannerHtml}}
      <tr><td class="px-card" style="padding:6px 44px 6px 44px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748B;">${footerNote}</p>
      </td></tr>
      <tr><td class="px-card" style="padding:14px 44px 32px 44px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748B;">Saludos,<br/>El equipo de Law||Analytics</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:22px 12px 0 12px;">
    <p style="margin:0 0 8px 0; font-size:12px; color:#94A3B8; text-align:center; letter-spacing:0.02em;">© 2026 Law||Analytics · Plataforma argentina de gestión jurídica</p>
    <p style="margin:0; font-size:12px; color:#94A3B8; text-align:center;"><a href="{{process.env.BASE_URL}}/privacy-policy" style="color:#94A3B8; text-decoration:none;">Privacidad</a> <span style="color:#CBD5E1;">&nbsp;·&nbsp;</span> <a href="{{process.env.BASE_URL}}/terms" style="color:#94A3B8; text-decoration:none;">Términos</a><span style="color:#CBD5E1;">&nbsp;·&nbsp;</span><a href="{{process.env.BASE_URL}}/unsubscribe?email={{userEmail}}" style="color:#94A3B8; text-decoration:underline;">Desuscribirse</a></p>
  </td></tr>
</table>
</td></tr>
</table>
{{trackingPixelHtml}}
</body>
</html>`;
}

const TEMPLATES = {
  'folder-caducity': {
    subject: 'Law||Analytics: {{foldersCount}} carpeta(s) próximas a caducar por inactividad',
    preheader: 'Carpetas sin actividad próximas a caducar — revisalas antes del vencimiento.',
    eyebrow: 'Caducidad por inactividad',
    titulo: 'Carpetas próximas a caducar',
    lede: 'Detectamos {{foldersCount}} carpeta(s) sin actividad reciente que podrían caducar (límite configurado: {{caducityDays}} días de inactividad). Te las listamos para que puedas actuar a tiempo.',
    sectionTitle: 'Carpetas en riesgo de caducidad',
    ctaLabel: 'Ver mis causas',
    ctaPath: '/apps/folders/list?source=email_inactividad_cta',
    footerNote: 'Recibís este aviso porque tenés habilitadas las alertas de inactividad. Podés ajustar los umbrales de caducidad y la anticipación desde la configuración de tu cuenta.',
    text: `Hola {{userName}},

Detectamos {{foldersCount}} carpeta(s) sin actividad reciente que podrían caducar (límite: {{caducityDays}} días de inactividad).

{{foldersListText}}
Ver mis causas: {{process.env.BASE_URL}}/apps/folders/list?source=email_inactividad_cta
{{planBannerText}}{{featureBannerText}}
Recibís este aviso porque tenés habilitadas las alertas de inactividad.

Saludos,
El equipo de Law||Analytics`
  },
  'folder-prescription': {
    subject: 'Law||Analytics: {{foldersCount}} carpeta(s) próximas a prescribir por inactividad',
    preheader: 'Carpetas sin actividad próximas a prescribir — revisalas antes del vencimiento.',
    eyebrow: 'Prescripción por inactividad',
    titulo: 'Carpetas próximas a prescribir',
    lede: 'Detectamos {{foldersCount}} carpeta(s) sin actividad reciente que podrían prescribir (límite configurado: {{prescriptionDays}} días de inactividad). Te las listamos para que puedas actuar a tiempo.',
    sectionTitle: 'Carpetas en riesgo de prescripción',
    ctaLabel: 'Ver mis causas',
    ctaPath: '/apps/folders/list?source=email_inactividad_cta',
    footerNote: 'Recibís este aviso porque tenés habilitadas las alertas de inactividad. Podés ajustar los umbrales de prescripción y la anticipación desde la configuración de tu cuenta.',
    text: `Hola {{userName}},

Detectamos {{foldersCount}} carpeta(s) sin actividad reciente que podrían prescribir (límite: {{prescriptionDays}} días de inactividad).

{{foldersListText}}
Ver mis causas: {{process.env.BASE_URL}}/apps/folders/list?source=email_inactividad_cta
{{planBannerText}}{{featureBannerText}}
Recibís este aviso porque tenés habilitadas las alertas de inactividad.

Saludos,
El equipo de Law||Analytics`
  }
};

(async () => {
  await mongoose.connect(process.env.URLDB);
  const coll = mongoose.connection.db.collection('emailtemplates');

  for (const [name, cfg] of Object.entries(TEMPLATES)) {
    const html = buildShell(cfg);
    // Escribimos htmlContent Y htmlBody con el mismo contenido (gotcha del
    // campo dual: getProcessedTemplate lee htmlContent || htmlBody).
    const res = await coll.updateOne(
      { category: 'notification', name },
      { $set: { subject: cfg.subject, preheader: cfg.preheader, htmlContent: html, htmlBody: html, textContent: cfg.text, textBody: cfg.text } }
    );
    console.log(`${name}: matched=${res.matchedCount} modified=${res.modifiedCount}`);
  }

  await mongoose.connection.close();
  console.log('Listo.');
})().catch(e => { console.error(e.message); process.exit(1); });
