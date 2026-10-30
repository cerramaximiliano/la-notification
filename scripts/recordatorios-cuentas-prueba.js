/**
 * Corre los recordatorios de calendario y tareas (correo y navegador) SOLO para cuentas
 * de prueba, con la misma lógica que la rutina matinal. Sirve para verificar destinatarios
 * de equipos sin esperar a las 9:00 ni tocar a otros usuarios (30/10/2026).
 *
 *   node scripts/recordatorios-cuentas-prueba.js email1 email2 ...
 *
 * Se niega a correr si algún usuario no tiene isTestAccount = true.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { User, Event, Task, Alert } = require('../models');
const logger = require('../config/logger');
const { sendEmail } = require('../services/email');
const { sendCalendarNotifications, sendTaskNotifications } = require('../services/notifications');
const { sendCalendarBrowserAlerts, sendTaskBrowserAlerts } = require('../services/browser');

(async () => {
  const emails = process.argv.slice(2).map((e) => e.toLowerCase());
  if (emails.length === 0) {
    console.log('Uso: node scripts/recordatorios-cuentas-prueba.js email1 email2 ...');
    process.exit(1);
  }
  await mongoose.connect(process.env.URLDB);
  const users = await User.find({ email: { $in: emails } });
  // isTestAccount no está en el schema local: se lee de la colección cruda.
  const raw = await mongoose.connection.db.collection(User.collection.name)
    .find({ _id: { $in: users.map((u) => u._id) } }, { projection: { isTestAccount: 1 } }).toArray();
  const noPrueba = raw.filter((u) => u.isTestAccount !== true);
  if (users.length !== emails.length || noPrueba.length > 0) {
    console.log(`Abortado: ${emails.length - users.length} sin encontrar, ${noPrueba.length} no son cuentas de prueba`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const utilities = { sendEmail, logger, mongoose, moment: require('moment') };
  for (const user of users) {
    const ch = user.preferences?.notifications?.channels || {};
    const r = {};
    if (ch.email !== false) {
      r.calCorreo = (await sendCalendarNotifications({ userId: user._id, models: { User, Event }, utilities })).count || 0;
      r.tareasCorreo = (await sendTaskNotifications({ userId: user._id, models: { User, Task }, utilities })).count || 0;
    }
    if (ch.browser === true) {
      r.calNavegador = (await sendCalendarBrowserAlerts({ userId: user._id, models: { User, Event, Alert }, utilities })).count || 0;
      r.tareasNavegador = (await sendTaskBrowserAlerts({ userId: user._id, models: { User, Task, Alert }, utilities })).count || 0;
    }
    console.log(user.email.split('@')[0], JSON.stringify(r));
  }
  await mongoose.disconnect();
})().catch(async (e) => {
  console.log('Error: ' + e.message);
  process.exit(1);
});
