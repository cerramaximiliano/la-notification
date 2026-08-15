/**
 * Rediseña administration/judicial-movement-report con el shell unificado
 * (es el informe que más se recibe: 3 veces por día + ante errores) y
 * desactiva folder-inactivity-report, que quedó sin uso tras la unificación
 * matinal — su contenido ahora va dentro de administration/morning-digest.
 *
 * Idempotente. Uso: node scripts/redesign-judicial-report-template.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const LOGO = 'https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png';

const fila = (label, value) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E6EAF2;border-radius:8px;margin-bottom:8px;">
              <tr><td style="padding:9px 12px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="font-size:13px;color:#475569;">${label}</td>
                  <td align="right" style="font-size:14px;font-weight:700;color:#0F172A;">${value}</td>
                </tr></table>
              </td></tr>
            </table>`;

const seccion = (titulo, filas, color = '#EFF4FF', textColor = '#3A7BFF') => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF2;border-radius:10px;overflow:hidden;margin-bottom:12px;">
        <tr><td style="background-color:${color};padding:11px 18px;">
          <p style="margin:0;font-size:11px;color:${textColor};letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">${titulo}</p>
        </td></tr>
        <tr><td style="background-color:#F8FAFC;border-top:1px solid #E6EAF2;padding:14px 18px 6px 18px;">${filas}</td></tr>
      </table>`;

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
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F4F5F7;">Informe de coordinación y envío de movimientos judiciales.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F7;">
<tr><td class="px-outer" align="center" style="padding:32px 24px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
  <tr><td style="padding:0 0 18px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="vertical-align:middle;"><img src="${LOGO}" width="148" height="auto" alt="Law||Analytics" style="display:block;max-width:148px;height:auto;border:0;"/></td>
      <td align="right" style="vertical-align:middle;font-size:12px;color:#3A7BFF;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Monitoreo interno</td>
    </tr></table>
  </td></tr>
  <tr><td style="background-color:#FFFFFF; border:1px solid #E6EAF2; border-radius:14px; overflow:hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px-card" style="padding:36px 44px 8px 44px;">
        <p style="margin:0 0 10px 0; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; font-weight:700; color:#3A7BFF;">Movimientos judiciales</p>
        <h1 class="h1-display" style="margin:0 0 12px 0; font-size:28px; line-height:1.2; letter-spacing:-0.5px; font-weight:600; color:{{statusColor}};">{{statusIcon}} {{statusText}}</h1>
        <p style="margin:0 0 4px 0; font-size:14px; line-height:1.6; color:#475569;">{{totalNotificacionesEnviadas}} notificación(es) enviada(s) · {{totalDocumentosCreados}} documento(s) creado(s) por el coordinador.</p>
        <p style="margin:0; font-size:12px; color:#94A3B8;">{{timestamp}} · fecha procesada: {{fechaProcesada}}</p>
      </td></tr>
      <tr><td class="px-card" style="padding:18px 44px 4px 44px;">
${seccion('Coordinación', `${fila('Causas encontradas', '{{causasEncontradas}}')}${fila('Movimientos del día', '{{movimientosDelDia}}')}${fila('Usuarios vinculados', '{{usuariosVinculados}}')}${fila('Documentos creados', '{{notificacionesCreadas}}')}${fila('Ya existentes', '{{notificacionesExistentes}}')}${fila('Errores', '{{erroresCoordinacion}}')}`)}
${seccion('Envío', `${fila('Usuarios pendientes', '{{usuariosPendientes}}')}${fila('Notificaciones enviadas', '{{notificacionesEnviadas}}')}${fila('Usuarios notificados', '{{usuariosExitosos}}')}${fila('Usuarios con error', '{{usuariosFallidos}}')}`)}
      </td></tr>
      <tr><td class="px-card" style="padding:6px 44px 32px 44px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#94A3B8;">Total de errores en la corrida: {{totalErrores}}. Este informe se envía en las horas configuradas y ante cualquier error.</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:22px 12px 0 12px;">
    <p style="margin:0; font-size:12px; color:#94A3B8; text-align:center;">© 2026 Law||Analytics · Monitoreo interno</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

const TEXT = `{{statusIcon}} {{statusText}}
{{timestamp}} · fecha procesada: {{fechaProcesada}}

COORDINACIÓN
- Causas encontradas: {{causasEncontradas}}
- Movimientos del día: {{movimientosDelDia}}
- Usuarios vinculados: {{usuariosVinculados}}
- Documentos creados: {{notificacionesCreadas}} (ya existentes: {{notificacionesExistentes}})
- Errores: {{erroresCoordinacion}}

ENVÍO
- Usuarios pendientes: {{usuariosPendientes}}
- Notificaciones enviadas: {{notificacionesEnviadas}}
- Usuarios notificados: {{usuariosExitosos}}
- Usuarios con error: {{usuariosFallidos}}

Total de errores: {{totalErrores}}`;

(async () => {
  await mongoose.connect(process.env.URLDB);
  const coll = mongoose.connection.db.collection('emailtemplates');

  const r = await coll.updateOne(
    { category: 'administration', name: 'judicial-movement-report' },
    { $set: { htmlContent: HTML, htmlBody: HTML, textContent: TEXT, textBody: TEXT, updatedAt: new Date() } }
  );
  console.log('judicial-movement-report:', r.matchedCount ? 'rediseñado' : 'NO ENCONTRADO');

  const r2 = await coll.updateOne(
    { category: 'administration', name: 'folder-inactivity-report' },
    { $set: { isActive: false, description: 'OBSOLETO — su contenido va en administration/morning-digest desde 2026-08-15' } }
  );
  console.log('folder-inactivity-report:', r2.modifiedCount ? 'desactivado' : 'sin cambios');

  await mongoose.connection.close();
})().catch(e => { console.error(e.message); process.exit(1); });
