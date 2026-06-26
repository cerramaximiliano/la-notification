/**
 * Upsert del template de email notification/judicial-movements en la colección
 * `emailtemplates` desde el archivo fuente templates/judicial-movement-template.js.
 *
 * la-notification es DB-only para el envío: el cron usa el htmlContent/subject del
 * doc en `emailtemplates`. Por eso, tras editar el archivo fuente, hay que correr
 * este script para reflejar los cambios en la DB.
 *
 * USO: node scripts/seed-judicial-movements-template.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { EmailTemplate } = require('../models');
const tpl = require('../templates/judicial-movement-template');

async function main() {
  const uri = process.env.URLDB || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Falta URLDB en el entorno');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Conectado a Mongo. Upserting template notification/judicial-movements...');

  const update = {
    category: tpl.category,
    name: tpl.name,
    subject: tpl.subject,
    preheader: tpl.preheader,
    description: tpl.description,
    tags: tpl.tags,
    variables: tpl.variables,
    htmlContent: tpl.htmlContent,
    textContent: tpl.textContent,
    isActive: true
  };

  const res = await EmailTemplate.findOneAndUpdate(
    { category: tpl.category, name: tpl.name },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`✅ Template actualizado: _id=${res._id}`);
  console.log(`   subject: ${res.subject}`);
  console.log(`   variables: ${(res.variables || []).join(', ')}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
