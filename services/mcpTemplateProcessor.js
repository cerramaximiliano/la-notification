/**
 * Fallback en código del aviso "aplicación conectada a tu cuenta" (MCP/OAuth).
 *
 * Mismo shell que el resto de los emails del sistema, para que el aviso se vea
 * igual haya o no template en la base. El eyebrow es de seguridad (ámbar) en
 * lugar del azul habitual: es un aviso de cuenta, no una notificación de
 * actividad.
 */

const LOGO = 'https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png';

function buildMcpAppConnectedFallback(vars) {
  const frontBase = vars['process.env.BASE_URL'] || 'https://www.lawanalytics.app';

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
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
  .h1-display { font-size:26px !important; }
}
</style>
</head>
<body style="margin:0; padding:0; background-color:#F4F5F7; color:#0F172A;">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F4F5F7;">Conectaste una aplicación a tu cuenta de Law||Analytics.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F7;">
<tr><td class="px-outer" align="center" style="padding:32px 24px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
  <tr><td style="padding:0 0 18px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="vertical-align:middle;"><img src="${LOGO}" width="148" height="auto" alt="Law||Analytics" style="display:block;max-width:148px;height:auto;border:0;"/></td>
      <td align="right" style="vertical-align:middle;font-size:12px;color:#B45309;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Seguridad de la cuenta</td>
    </tr></table>
  </td></tr>
  <tr><td style="background-color:#FFFFFF; border:1px solid #E6EAF2; border-radius:14px; overflow:hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px-card" style="padding:36px 44px 8px 44px;">
        <h1 class="h1-display" style="margin:0 0 18px 0; font-size:28px; line-height:1.2; letter-spacing:-0.5px; font-weight:600; color:#0F172A;">Conectaste una aplicación a tu cuenta</h1>
        <p style="margin:0 0 6px 0; font-size:16px; line-height:1.6; color:#334155;">Hola ${vars.userName},</p>
        <p style="margin:0 0 8px 0; font-size:16px; line-height:1.6; color:#334155;">Autorizaste a <b>${vars.appName}</b> a acceder a los datos de tu cuenta de Law||Analytics. Si fuiste vos, no tenés que hacer nada.</p>
      </td></tr>
      <tr><td class="px-card" style="padding:12px 44px 4px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E6EAF2;border-radius:10px;overflow:hidden;">
          <tr><td style="background-color:#FFF7ED;padding:11px 18px;">
            <p style="margin:0;font-size:11px;color:#B45309;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">Detalle de la conexión</p>
          </td></tr>
          <tr><td style="background-color:#F8FAFC;border-top:1px solid #E6EAF2;padding:14px 18px 6px 18px;">${vars.detallesHtml}</td></tr>
        </table>
      </td></tr>
      <tr><td class="px-card" style="padding:20px 44px 12px 44px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="#3A7BFF" style="border-radius:8px;box-shadow:0 6px 20px -8px rgba(58,123,255,0.55);">
            <a href="${vars.ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:-0.1px;border-radius:8px;">Gestionar aplicaciones conectadas&nbsp;&#8594;</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td class="px-card" style="padding:6px 44px 6px 44px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748B;"><b>¿No reconocés esta conexión?</b> Revocá el acceso desde el botón de arriba y cambiá tu contraseña.</p>
      </td></tr>
      <tr><td class="px-card" style="padding:14px 44px 32px 44px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748B;">Saludos,<br/>El equipo de Law||Analytics</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:22px 12px 0 12px;">
    <p style="margin:0 0 8px 0; font-size:12px; color:#94A3B8; text-align:center; letter-spacing:0.02em;">© 2026 Law||Analytics · Plataforma argentina de gestión jurídica</p>
    <p style="margin:0; font-size:12px; color:#94A3B8; text-align:center;"><a href="${frontBase}/privacy-policy" style="color:#94A3B8; text-decoration:none;">Privacidad</a> <span style="color:#CBD5E1;">&nbsp;·&nbsp;</span> <a href="${frontBase}/terms" style="color:#94A3B8; text-decoration:none;">Términos</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = `Hola ${vars.userName},

Autorizaste a ${vars.appName} a acceder a los datos de tu cuenta de Law||Analytics.
Si fuiste vos, no tenés que hacer nada.

${vars.detallesText}

¿No reconocés esta conexión? Revocá el acceso y cambiá tu contraseña:
${vars.ctaUrl}

Saludos,
El equipo de Law||Analytics`;

  return {
    subject: `Law||Analytics: conectaste ${vars.appName} a tu cuenta`,
    html,
    text
  };
}

module.exports = { buildMcpAppConnectedFallback };
