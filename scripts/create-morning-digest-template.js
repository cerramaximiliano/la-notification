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

const HTML = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Rutina matinal de notificaciones</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0F172A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F7;">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;">
  <tr><td style="padding:0 0 14px 0;">
    <p style="margin:0;font-size:15px;font-weight:700;color:#0F172A;">Law||Analytics · Monitoreo</p>
  </td></tr>
  <tr><td style="background-color:#FFFFFF;border:1px solid #E6EAF2;border-radius:12px;padding:24px;">
    <p style="margin:0 0 2px 0;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#64748B;">Rutina matinal de notificaciones</p>
    <h1 style="margin:0 0 4px 0;font-size:20px;line-height:1.25;color:{{statusColor}};">{{statusIcon}} {{statusText}}</h1>
    <p style="margin:0 0 16px 0;font-size:12px;color:#94A3B8;">{{timestamp}} · {{totalNotificaciones}} notificación(es) enviada(s) en total</p>
    {{seccionesHtml}}
    <p style="margin:14px 0 0 0;font-size:11px;color:#94A3B8;">Este informe reemplaza los cuatro correos separados que se enviaban entre las 9:00 y las 10:00.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

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
