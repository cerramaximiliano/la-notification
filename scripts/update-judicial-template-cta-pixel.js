/**
 * Actualiza el template DB notification/judicial-movements (rediseño 2026-07):
 *   1. CTA global dinámico: href/label hardcodeados → {{ctaUrl}} / {{ctaLabel}}
 *      (con un solo expediente el botón va directo a la causa).
 *   2. Pixel de apertura: agrega {{trackingPixelHtml}} antes de </body>.
 *
 * ⚠️ ORDEN: correr DESPUÉS de deployar la-notification (el código nuevo pasa las
 * variables; el template nuevo las necesita — al revés quedarían literales
 * "{{ctaUrl}}" en los emails).
 *
 * Uso: node scripts/update-judicial-template-cta-pixel.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const OLD_CTA =
  '<a class="cta" href="https://www.lawanalytics.app/apps/folders/list" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:-0.1px;border-radius:8px;">Ver mis causas&nbsp;&#8594;</a>';
const NEW_CTA =
  '<a class="cta" href="{{ctaUrl}}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:-0.1px;border-radius:8px;">{{ctaLabel}}&nbsp;&#8594;</a>';

(async () => {
  const uri = process.env.MONGODB_URI || process.env.URLDB;
  if (!uri) throw new Error('Falta MONGODB_URI/URLDB en el entorno');
  await mongoose.connect(uri);
  const col = mongoose.connection.db.collection('emailtemplates');

  const doc = await col.findOne({ name: 'judicial-movements' });
  if (!doc) throw new Error('Template judicial-movements no encontrado');

  // ⚠️ El campo ACTIVO es htmlContent (getProcessedTemplate lo prefiere sobre
  // htmlBody, que quedó como copia vieja SIN los slots de cédulas). Editamos
  // htmlContent y sincronizamos htmlBody al mismo valor para eliminar la trampa.
  let html = doc.htmlContent || '';
  if (!html) throw new Error('El template no tiene htmlContent');
  const changes = [];

  if (html.includes(OLD_CTA)) {
    html = html.replace(OLD_CTA, NEW_CTA);
    changes.push('cta dinámico');
  } else if (html.includes('{{ctaUrl}}')) {
    console.log('CTA ya es dinámico — skip');
  } else {
    throw new Error('No se encontró el CTA hardcodeado esperado — revisar el template a mano');
  }

  if (!html.includes('{{trackingPixelHtml}}')) {
    html = html.replace('</body>', '{{trackingPixelHtml}}</body>');
    changes.push('pixel de apertura');
  } else {
    console.log('Pixel ya presente — skip');
  }

  if (changes.length) {
    await col.updateOne({ _id: doc._id }, { $set: { htmlContent: html, htmlBody: html, updatedAt: new Date() } });
    console.log('Template actualizado (htmlContent + htmlBody sincronizados):', changes.join(' + '));
  } else {
    console.log('Sin cambios necesarios');
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error('FALLO:', e.message);
  process.exit(1);
});
