/**
 * Agrega el slot {{gcalBannerHtml}}/{{gcalBannerText}} (banner de invitación a
 * sincronizar Google Calendar) a los templates que ya tienen la cadena de
 * banners, inmediatamente después del feature banner: los promocionales van
 * primero y el strip de opciones queda último.
 *
 * Patchea los CUATRO campos legacy (htmlContent/htmlBody, textContent/textBody)
 * porque getProcessedTemplate lee htmlContent || htmlBody y los docs están
 * repartidos entre ambos. Idempotente: si el slot ya está, no toca.
 *
 * Uso: node scripts/add-gcal-banner-slot.js [--apply]
 */

require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.URLDB);
  const col = mongoose.connection.db.collection('emailtemplates');

  const docs = await col.find({
    $or: [
      { htmlContent: /\{\{featureBannerHtml\}\}/ },
      { htmlBody: /\{\{featureBannerHtml\}\}/ }
    ]
  }).toArray();

  console.log(`Templates con cadena de banners: ${docs.length}\n`);

  for (const doc of docs) {
    const updates = {};
    const notas = [];

    for (const field of ['htmlContent', 'htmlBody']) {
      const v = doc[field];
      if (!v) continue;
      if (v.includes('{{gcalBannerHtml}}')) { notas.push(`${field}: ya tenía el slot`); continue; }
      if (!v.includes('{{featureBannerHtml}}')) { notas.push(`${field}: sin cadena de banners`); continue; }
      updates[field] = v.replace('{{featureBannerHtml}}', '{{featureBannerHtml}}{{gcalBannerHtml}}');
      notas.push(`${field}: slot agregado`);
    }

    for (const field of ['textContent', 'textBody']) {
      const v = doc[field];
      if (!v) continue;
      if (v.includes('{{gcalBannerText}}')) { notas.push(`${field}: ya tenía el slot`); continue; }
      if (!v.includes('{{featureBannerText}}')) { notas.push(`${field}: sin cadena de banners`); continue; }
      updates[field] = v.replace('{{featureBannerText}}', '{{featureBannerText}}{{gcalBannerText}}');
      notas.push(`${field}: slot agregado`);
    }

    console.log(`${doc.category}/${doc.name}`);
    notas.forEach((n) => console.log(`   ${n}`));

    if (Object.keys(updates).length && APPLY) {
      await col.updateOne({ _id: doc._id }, { $set: updates });
      console.log('   ✅ actualizado');
    }
  }

  if (!APPLY) console.log('\nDRY-RUN: nada se escribió. Correr con --apply para aplicar.');
  await mongoose.disconnect();
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
