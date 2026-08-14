/**
 * Agrega los slots de banners a los shells que todavía no los tienen
 * (calendar-events, tasks-reminder, movements-expiration).
 *
 * Los banners se renderizan como <tr><td class="px-card">…</td></tr>, así que
 * deben quedar como ÚLTIMAS FILAS de la tabla interna de la card — después del
 * bloque de contenido y antes del footer externo (px-outer). Sin esto caían al
 * final del <body> por el fallback runtime, es decir debajo del pie del correo.
 *
 * CORRER DESPUÉS de deployar el código que pasa las variables.
 * Idempotente. Uso: node scripts/add-banner-slots-shells.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const TEMPLATES = ['calendar-events', 'tasks-reminder', 'movements-expiration'];
const SLOTS = '{{planBannerHtml}}{{featureBannerHtml}}{{optionsBannerHtml}}';
const TEXT_SLOTS = '{{planBannerText}}{{featureBannerText}}{{optionsBannerText}}';

// Cierre del contenido de la card → apertura del footer externo.
const ANCHOR_RE = /(<\/td>\s*<\/tr>\s*)(<\/table>\s*<\/td>\s*<\/tr>\s*<tr>\s*<td class="px-outer")/;

(async () => {
  await mongoose.connect(process.env.URLDB);
  const coll = mongoose.connection.db.collection('emailtemplates');

  for (const name of TEMPLATES) {
    const doc = await coll.findOne({ category: 'notification', name });
    if (!doc) { console.log(`${name}: NO EXISTE`); continue; }

    let touched = false;
    for (const field of ['htmlContent', 'htmlBody']) {
      const html = doc[field];
      if (!html) continue;
      if (html.includes('{{planBannerHtml}}')) { console.log(`${name}.${field}: ya tiene slots`); continue; }
      if (!ANCHOR_RE.test(html)) { console.log(`${name}.${field}: ANCLA NO ENCONTRADA — skip`); continue; }
      await coll.updateOne({ _id: doc._id }, { $set: { [field]: html.replace(ANCHOR_RE, `$1${SLOTS}$2`) } });
      console.log(`${name}.${field}: slots agregados`);
      touched = true;
    }

    // Versión texto: al final, antes de la firma si existe.
    for (const field of ['textContent', 'textBody']) {
      const text = doc[field];
      if (!text) continue;
      if (text.includes('{{planBannerText}}')) continue;
      const updated = /\n[^\n]*(Saludos|El equipo de Law)/.test(text)
        ? text.replace(/(\n[^\n]*(?:Saludos|El equipo de Law))/, `\n${TEXT_SLOTS}$1`)
        : text + `\n${TEXT_SLOTS}\n`;
      await coll.updateOne({ _id: doc._id }, { $set: { [field]: updated } });
      console.log(`${name}.${field}: slot de texto agregado`);
      touched = true;
    }

    if (!touched) console.log(`${name}: sin cambios`);
  }

  await mongoose.connection.close();
  console.log('Listo.');
})().catch(e => { console.error(e.message); process.exit(1); });
