/**
 * Clasifica los emailtemplates por fuente de envío:
 *   - sendingSource: 'la-notification' → los 12 templates que envía este servicio
 *   - sendingSource: 'marketing'       → todos los demás
 *
 * Idempotente. Uso: node scripts/tag-template-sources.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Templates enviados por la-notification (categoria/nombre)
const LA_NOTIFICATION_TEMPLATES = [
  ['notification', 'judicial-movements'],
  ['notification', 'calendar-events'],
  ['notification', 'tasks-reminder'],
  ['notification', 'movements-expiration'],
  ['notification', 'folder-caducity'],
  ['notification', 'folder-prescription'],
  ['administration', 'judicial-movement-report'],
  ['administration', 'folder-inactivity-report'],
  ['administration', 'calendar-notifications-report'],
  ['administration', 'task-notifications-report'],
  ['administration', 'movement-notifications-report'],
  ['administration', 'log-cleanup-report']
];

(async () => {
  await mongoose.connect(process.env.URLDB);
  const coll = mongoose.connection.db.collection('emailtemplates');

  const notifFilter = { $or: LA_NOTIFICATION_TEMPLATES.map(([category, name]) => ({ category, name })) };
  const r1 = await coll.updateMany(notifFilter, { $set: { sendingSource: 'la-notification' } });
  const r2 = await coll.updateMany(
    { $nor: LA_NOTIFICATION_TEMPLATES.map(([category, name]) => ({ category, name })) },
    { $set: { sendingSource: 'marketing' } }
  );
  console.log(`la-notification: ${r1.modifiedCount}/${r1.matchedCount} · marketing: ${r2.modifiedCount}/${r2.matchedCount}`);

  const counts = await coll.aggregate([{ $group: { _id: '$sendingSource', n: { $sum: 1 } } }]).toArray();
  console.log('resultado:', JSON.stringify(counts));
  await mongoose.connection.close();
})().catch(e => { console.error(e.message); process.exit(1); });
