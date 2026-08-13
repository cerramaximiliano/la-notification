/**
 * Agrega el CTA a la app (botón unificado, con ?source= para atribución de
 * visitas logueadas) a los shells de calendar-events, tasks-reminder y
 * movements-expiration, que no tenían ningún botón a la app.
 *
 * Idempotente (si ya hay source=email_ en el body, skipea).
 * Uso: node scripts/add-shell-ctas.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const CTAS = {
  'calendar-events': { path: '/apps/calendar', source: 'email_calendario_cta', label: 'Ver mi calendario' },
  'tasks-reminder': { path: '/tareas', source: 'email_tareas_cta', label: 'Ver mis tareas' },
  'movements-expiration': { path: '/apps/folders/list', source: 'email_vencimiento_cta', label: 'Ver mis causas' }
};

const ANCHOR_RE = /(<\/table>)(<p style="margin:0 0 14px 0; font-size:16px; line-height:1\.6; color:#334155;">Podés ver)/;

function ctaBlock({ path, source, label }) {
  return `</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px 0;"><tr>
  <td bgcolor="#3A7BFF" style="border-radius:8px;box-shadow:0 6px 20px -8px rgba(58,123,255,0.55);">
    <a href="\${process.env.BASE_URL}${path}?source=${source}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:-0.1px;border-radius:8px;">${label}&nbsp;&#8594;</a>
  </td>
</tr></table>
`;
}

(async () => {
  await mongoose.connect(process.env.URLDB);
  const coll = mongoose.connection.db.collection('emailtemplates');

  for (const [name, cta] of Object.entries(CTAS)) {
    const d = await coll.findOne({ category: 'notification', name });
    if (!d) { console.log(`${name}: NO EXISTE`); continue; }
    // El campo efectivo es htmlContent || htmlBody — estos tres solo tienen htmlBody.
    const field = d.htmlContent ? 'htmlContent' : 'htmlBody';
    const html = d[field];
    if (html.includes('source=email_')) { console.log(`${name}: ya tiene CTA con source, skip`); continue; }
    if (!ANCHOR_RE.test(html)) { console.log(`${name}: ANCLA NO ENCONTRADA — skip`); continue; }
    const updated = html.replace(ANCHOR_RE, `${ctaBlock(cta)}$2`);
    await coll.updateOne({ _id: d._id }, { $set: { [field]: updated } });

    // Versión texto: agregar el link al final si no está
    const textField = d.textContent ? 'textContent' : 'textBody';
    if (d[textField] && !d[textField].includes(`?source=${cta.source}`)) {
      await coll.updateOne({ _id: d._id }, { $set: { [textField]: d[textField] + `\n${cta.label}: \${process.env.BASE_URL}${cta.path}?source=${cta.source}\n` } });
    }
    console.log(`${name}: CTA agregado (${cta.path}?source=${cta.source})`);
  }

  await mongoose.connection.close();
})().catch(e => { console.error(e.message); process.exit(1); });
