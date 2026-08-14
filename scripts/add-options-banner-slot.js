/**
 * Agrega los slots {{featureBannerHtml}}{{optionsBannerHtml}} al template
 * judicial-movements, a continuación de {{planBannerHtml}} (después del CTA
 * global, antes del footer). Así el strip de opciones queda arriba del footer
 * y debajo del banner de planes, y el feature banner también gana posición
 * propia en este email (antes caía al fondo por fallback).
 *
 * CORRER DESPUÉS de deployar el código que pasa optionsBannerHtml.
 * Idempotente. Uso: node scripts/add-options-banner-slot.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.URLDB);
  const coll = mongoose.connection.db.collection('emailtemplates');
  const doc = await coll.findOne({ category: 'notification', name: 'judicial-movements' });

  for (const field of ['htmlContent', 'htmlBody']) {
    const html = doc[field];
    if (!html) { console.log(`${field}: vacío, skip`); continue; }
    if (html.includes('{{optionsBannerHtml}}')) { console.log(`${field}: ya tiene slot, skip`); continue; }
    if (!html.includes('{{planBannerHtml}}')) { console.log(`${field}: SIN {{planBannerHtml}} — skip`); continue; }
    const updated = html.replace('{{planBannerHtml}}', '{{planBannerHtml}}{{featureBannerHtml}}{{optionsBannerHtml}}');
    await coll.updateOne({ _id: doc._id }, { $set: { [field]: updated } });
    console.log(`${field}: slots agregados`);
  }

  for (const field of ['textContent', 'textBody']) {
    const text = doc[field];
    if (!text) { console.log(`${field}: vacío, skip`); continue; }
    if (text.includes('{{optionsBannerText}}')) { console.log(`${field}: ya tiene slot, skip`); continue; }
    if (!text.includes('{{planBannerText}}')) { console.log(`${field}: SIN {{planBannerText}} — skip`); continue; }
    const updated = text.replace('{{planBannerText}}', '{{planBannerText}}{{featureBannerText}}{{optionsBannerText}}');
    await coll.updateOne({ _id: doc._id }, { $set: { [field]: updated } });
    console.log(`${field}: slot agregado`);
  }

  await mongoose.connection.close();
  console.log('Listo.');
})().catch(e => { console.error(e.message); process.exit(1); });
