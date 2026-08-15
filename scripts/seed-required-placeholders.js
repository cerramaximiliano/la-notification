/**
 * Marca los templates de sistema (los que consume la-notification) con
 * `protected: true` y la lista de `requiredPlaceholders` que no pueden perder.
 *
 * Si una edición desde el panel borra uno de esos slots, el bloque desaparece
 * del email sin ningún error visible. Con esto, la API de plantillas rechaza
 * el guardado y explica qué falta.
 *
 * Idempotente. Uso: node scripts/seed-required-placeholders.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Slots imprescindibles por template (el contenido dinámico principal).
// Los banners NO se listan: ya tienen fallback runtime si el slot falta.
const REQUIRED = {
  'notification/judicial-movements': ['{{expedientesHtml}}', '{{userName}}'],
  'notification/calendar-events': ['${eventsTableHtml}', '${userName}'],
  'notification/tasks-reminder': ['${tasksTableHtml}', '${userName}'],
  'notification/movements-expiration': ['${movementsTableHtml}', '${userName}'],
  'notification/folder-caducity': ['{{foldersTableHtml}}', '{{userName}}'],
  'notification/folder-prescription': ['{{foldersTableHtml}}', '{{userName}}'],
  'notification/postal-tracking-update': ['{{eventosHtml}}', '{{userName}}'],
  'administration/morning-digest': ['{{seccionesHtml}}'],
  'administration/judicial-movement-report': ['{{statusText}}'],
};

(async () => {
  await mongoose.connect(process.env.URLDB);
  const coll = mongoose.connection.db.collection('emailtemplates');

  for (const [key, placeholders] of Object.entries(REQUIRED)) {
    const [category, name] = key.split('/');
    const doc = await coll.findOne({ category, name });
    if (!doc) { console.log(`${key}: NO EXISTE — skip`); continue; }

    // Verificar que el template actual efectivamente los tenga (si no, avisar:
    // marcarlo igual dejaría el template en un estado no editable).
    const html = doc.htmlContent || doc.htmlBody || '';
    const faltantes = placeholders.filter((ph) => !html.includes(ph));
    if (faltantes.length > 0) {
      console.log(`${key}: ⚠ el template NO contiene ${faltantes.join(', ')} — se marca solo lo presente`);
    }
    const presentes = placeholders.filter((ph) => html.includes(ph));

    await coll.updateOne(
      { _id: doc._id },
      { $set: { requiredPlaceholders: presentes, protected: true } }
    );
    console.log(`${key}: protegido (${presentes.length} placeholder/s requeridos)`);
  }

  await mongoose.connection.close();
  console.log('Listo.');
})().catch(e => { console.error(e.message); process.exit(1); });
