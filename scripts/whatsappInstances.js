/**
 * Administración de líneas/instancias de Evolution API (models/WhatsAppInstance.js).
 * No hay UI admin todavía — este script es la única forma de cargar una línea.
 *
 * Uso:
 *   node scripts/whatsappInstances.js list
 *   node scripts/whatsappInstances.js add <name> <label> [phoneNumber]
 *   node scripts/whatsappInstances.js status <name> <pending_link|connected|disconnected|banned|disabled>
 *   node scripts/whatsappInstances.js enable <name>
 *   node scripts/whatsappInstances.js disable <name>
 *   node scripts/whatsappInstances.js channel on|off     (kill-switch del canal completo:
 *                                                         status.whatsappEnabled del config doc,
 *                                                         toma efecto en ≤60s sin restart)
 *
 * `name` tiene que ser el mismo nombre con el que la instancia está vinculada
 * en Evolution API (el que se usó al crearla/escanear el QR) — es lo que se
 * manda en /message/sendText/:instance.
 *
 * El status hay que pasarlo a 'connected' a mano una vez que la instancia ya
 * está vinculada y probada — mientras esté en 'pending_link' (default al
 * crearla) no entra en la rotación de envío (instances.js solo toma
 * enabled:true + status:'connected').
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command) {
    console.log(__filename.split('/').pop() + ': falta el comando (list|add|status|enable|disable|channel)');
    process.exit(1);
  }

  await mongoose.connect(process.env.URLDB);
  const { WhatsAppInstance } = require('../models');
  const JudicialNotificationConfig = require('../models/Judicial-notification-config');

  try {
    switch (command) {
      case 'channel': {
        const [value] = args;
        if (!['on', 'off'].includes(value)) {
          console.log('Uso: node scripts/whatsappInstances.js channel on|off');
          process.exit(1);
        }
        await JudicialNotificationConfig.updateOne(
          { configKey: 'global' },
          { $set: { 'status.whatsappEnabled': value === 'on' } }
        );
        console.log(`Canal WhatsApp → ${value === 'on' ? 'HABILITADO' : 'deshabilitado'} (status.whatsappEnabled=${value === 'on'}); toma efecto en ≤60s.`);
        break;
      }

      case 'list': {
        const config = await JudicialNotificationConfig.findOne({ configKey: 'global' }).select('status').lean();
        const channelOn = config?.status?.whatsappEnabled === true && config?.status?.enabled !== false && config?.status?.mode !== 'maintenance';
        console.log(`Canal WhatsApp: ${channelOn ? 'HABILITADO' : 'deshabilitado'} (status.whatsappEnabled=${config?.status?.whatsappEnabled === true})`);
        const list = await WhatsAppInstance.find().sort({ createdAt: 1 }).lean();
        if (list.length === 0) {
          console.log('No hay ninguna instancia de WhatsApp cargada todavía.');
          break;
        }
        console.table(list.map(i => ({
          name: i.name,
          label: i.label || '',
          phoneNumber: i.phoneNumber || '',
          status: i.status,
          enabled: i.enabled,
          dailyLimit: i.dailyLimit,
        })));
        break;
      }

      case 'add': {
        const [name, label, phoneNumber] = args;
        if (!name) {
          console.log('Uso: node scripts/whatsappInstances.js add <name> <label> [phoneNumber]');
          process.exit(1);
        }
        if (await WhatsAppInstance.exists({ name })) {
          console.log(`Ya existe una instancia con name='${name}'`);
          process.exit(1);
        }
        const doc = await WhatsAppInstance.create({ name, label, phoneNumber });
        console.log(`Instancia creada en estado 'pending_link':`, doc.toObject());
        console.log(`Cuando esté vinculada y probada: node scripts/whatsappInstances.js status ${name} connected`);
        break;
      }

      case 'status': {
        const [name, status] = args;
        const valid = ['pending_link', 'connected', 'disconnected', 'banned', 'disabled'];
        if (!name || !valid.includes(status)) {
          console.log(`Uso: node scripts/whatsappInstances.js status <name> <${valid.join('|')}>`);
          process.exit(1);
        }
        const doc = await WhatsAppInstance.findOneAndUpdate({ name }, { status }, { new: true });
        if (!doc) {
          console.log(`No existe ninguna instancia con name='${name}'`);
          process.exit(1);
        }
        console.log(`Instancia '${name}' → status: ${doc.status}`);
        break;
      }

      case 'enable':
      case 'disable': {
        const [name] = args;
        if (!name) {
          console.log(`Uso: node scripts/whatsappInstances.js ${command} <name>`);
          process.exit(1);
        }
        const doc = await WhatsAppInstance.findOneAndUpdate({ name }, { enabled: command === 'enable' }, { new: true });
        if (!doc) {
          console.log(`No existe ninguna instancia con name='${name}'`);
          process.exit(1);
        }
        console.log(`Instancia '${name}' → enabled: ${doc.enabled}`);
        break;
      }

      default:
        console.log(`Comando desconocido: ${command} (list|add|status|enable|disable)`);
        process.exit(1);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
