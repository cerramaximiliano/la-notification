/**
 * Crea/actualiza el template administration/morning-digest: informe matinal
 * unificado que reemplaza los 4 correos separados (calendario, tareas,
 * vencimientos e inactividad). Idempotente.
 *
 * El job tiene un fallback en código, así que el informe sale igual si este
 * documento no existe.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
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
  .h1-display { font-size:24px !important; }
}
</style>
</head>
<body style="margin:0; padding:0; background-color:#F4F5F7; color:#0F172A;">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F4F5F7;">Resumen de los trabajos matinales de notificaciones.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F7;">
<tr><td class="px-outer" align="center" style="padding:32px 24px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
  <tr><td style="padding:0 0 18px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="vertical-align:middle;"><img src="https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png" width="148" height="auto" alt="Law||Analytics" style="display:block;max-width:148px;height:auto;border:0;"/></td>
      <td align="right" style="vertical-align:middle;font-size:12px;color:#3A7BFF;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Monitoreo interno</td>
    </tr></table>
  </td></tr>
  <tr><td style="background-color:#FFFFFF; border:1px solid #E6EAF2; border-radius:14px; overflow:hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px-card" style="padding:36px 44px 8px 44px;">
        <p style="margin:0 0 10px 0; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; font-weight:700; color:#3A7BFF;">Rutina matinal</p>
        <h1 class="h1-display" style="margin:0 0 12px 0; font-size:28px; line-height:1.2; letter-spacing:-0.5px; font-weight:600; color:{{statusColor}};">{{statusIcon}} {{statusText}}</h1>
        <p style="margin:0 0 4px 0; font-size:14px; line-height:1.6; color:#475569;">{{totalNotificaciones}} notificación(es) enviada(s) en total.</p>
        <p style="margin:0; font-size:12px; color:#94A3B8;">{{timestamp}}</p>
      </td></tr>
      <tr><td class="px-card" style="padding:18px 44px 4px 44px;">{{seccionesHtml}}</td></tr>
      <tr><td class="px-card" style="padding:6px 44px 32px 44px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#94A3B8;">Informe unificado de los cuatro trabajos matinales (calendario, tareas, vencimientos e inactividad). Antes se enviaba uno por cada trabajo.</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:22px 12px 0 12px;">
    <p style="margin:0; font-size:12px; color:#94A3B8; text-align:center; letter-spacing:0.02em;">© 2026 Law||Analytics · Monitoreo interno</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

const TEXT = `{{statusIcon}} {{statusText}}
{{timestamp}} · {{totalNotificaciones}} notificación(es) enviada(s)

{{seccionesText}}

Este informe reemplaza los cuatro correos separados de la mañana.`;

(async () => {
  await mongoose.connect(process.env.URLDB);
  const coll = mongoose.connection.db.collection('emailtemplates');
  const res = await coll.updateOne(
    { category: 'administration', name: 'morning-digest' },
    {
      $set: {
        subject: '{{statusIcon}} Rutina matinal de notificaciones — {{fechaProcesada}}',
        description: 'Informe unificado de los trabajos matinales (calendario, tareas, vencimientos e inactividad)',
        htmlContent: HTML, htmlBody: HTML,
        textContent: TEXT, textBody: TEXT,
        isActive: true,
        sendingSource: 'la-notification',
        variables: ['statusIcon','statusText','statusColor','timestamp','fechaProcesada','totalNotificaciones','seccionesHtml','seccionesText'],
        updatedAt: new Date()
      },
      $setOnInsert: { category: 'administration', name: 'morning-digest', tags: [], createdAt: new Date() }
    },
    { upsert: true }
  );
  console.log('template morning-digest:', res.upsertedCount ? 'creado' : 'actualizado');
  await mongoose.connection.close();
})().catch(e => { console.error(e.message); process.exit(1); });
