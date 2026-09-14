/**
 * Administración de líneas/instancias de Evolution API (models/WhatsAppInstance.js).
 *
 * Uso:
 *   node scripts/whatsappInstances.js list
 *   node scripts/whatsappInstances.js link <name> [label] [+549...]   ← alta completa (ver abajo)
 *   node scripts/whatsappInstances.js qr <name> [+549...]             ← QR / pairing code nuevo
 *   node scripts/whatsappInstances.js add <name> <label> [phoneNumber] ← solo registro en Mongo
 *   node scripts/whatsappInstances.js status <name> <pending_link|connected|disconnected|banned|disabled>
 *   node scripts/whatsappInstances.js enable <name>
 *   node scripts/whatsappInstances.js disable <name>
 *   node scripts/whatsappInstances.js channel on|off     (kill-switch del canal completo:
 *                                                         status.whatsappEnabled del config doc;
 *                                                         también desde la admin UI)
 *
 * `link` hace todo el alta de una línea nueva contra Evolution API:
 *   1. registra la instancia en Mongo (pending_link) si no existe;
 *   2. crea la instancia en Evolution (POST /instance/create, WHATSAPP-BAILEYS) con el
 *      webhook ya configurado (MESSAGES_UPSERT, MESSAGES_UPDATE, CONNECTION_UPDATE, header
 *      apikey = EVOLUTION_WEBHOOK_APIKEY) — si ya existía, solo re-aplica el webhook;
 *   3. obtiene el QR y lo guarda como PNG en el directorio actual (abrirlo y escanearlo
 *      desde el teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo).
 *      Si pasás el número, Evolution también devuelve un *pairing code* de 8 caracteres:
 *      en el teléfono, "Vincular con el número de teléfono" → escribir el código, sin cámara;
 *   4. espera hasta que la conexión quede `open` y marca la línea `connected` en Mongo.
 *
 * Necesita EVOLUTION_API_URL y EVOLUTION_API_KEY (apikey global de Evolution) en el
 * entorno; opcional EVOLUTION_WEBHOOK_APIKEY y WHATSAPP_WEBHOOK_PUBLIC_URL (default
 * https://notifications.lawanalytics.app/api/whatsapp/webhook). Se puede correr desde
 * cualquier máquina que llegue a Evolution (ej. la laptop por Tailscale) y a Mongo.
 *
 * El nombre de instancia tiene que ser el mismo en Evolution y en Mongo — es lo que se
 * manda en /message/sendText/:instance.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const INSTANCE_STATUSES = ['pending_link', 'connected', 'disconnected', 'banned', 'disabled'];
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function requireEvolutionEnv() {
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
    console.log('Faltan EVOLUTION_API_URL y/o EVOLUTION_API_KEY en el entorno (apikey global de Evolution API).');
    process.exit(1);
  }
  // Misma lógica que usan los endpoints internos para la admin UI.
  return require('../services/channels/whatsapp/linking');
}

function saveQr(name, base64) {
  if (!base64) return null;
  const data = base64.replace(/^data:image\/\w+;base64,/, '');
  const file = path.resolve(process.cwd(), `whatsapp-qr-${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

function printQr(name, qr) {
  if (!qr) {
    console.log('Evolution no devolvió QR (respuesta {count:0}). Probá de nuevo con `qr <name>` en unos segundos, o mirá el Manager de Evolution (http://<host>:8080/manager).');
    return;
  }
  if (qr.alreadyOpen) {
    console.log('La instancia ya está conectada (state=open).');
    return;
  }
  const file = saveQr(name, qr.base64);
  if (file) console.log(`QR guardado en: ${file}  → abrilo y escanealo desde WhatsApp → Dispositivos vinculados → Vincular un dispositivo`);
  if (qr.pairingCode) console.log(`Pairing code: ${qr.pairingCode}  → en el teléfono: Vincular un dispositivo → "Vincular con el número de teléfono"`);
  console.log('El QR vence en ~1 minuto: si expira, `node scripts/whatsappInstances.js qr ' + name + '` genera otro.');
}

async function waitForOpen(linking, name) {
  const started = Date.now();
  process.stdout.write('Esperando que la línea se conecte (Ctrl+C para salir; se puede marcar `connected` después desde la admin)');
  while (Date.now() - started < CONNECT_TIMEOUT_MS) {
    const { state } = await linking.getState(name); // open → deja la línea connected en Mongo
    if (state === 'open') {
      console.log('\nConectada.');
      return true;
    }
    process.stdout.write('.');
    await sleep(5000);
  }
  console.log('\nNo se conectó en 5 minutos. Cuando escanees, marcá la línea como Conectada desde la admin (o `status <name> connected`).');
  return false;
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command) {
    console.log(__filename.split('/').pop() + ': falta el comando (list|link|qr|add|status|enable|disable|channel)');
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

      case 'link': {
        const [name, label, phoneNumber] = args;
        if (!name) {
          console.log('Uso: node scripts/whatsappInstances.js link <name> [label] [+549...]');
          process.exit(1);
        }
        const linking = requireEvolutionEnv();
        let result;
        try {
          result = await linking.createInstance({ name, label, phoneNumber });
        } catch (error) {
          console.log(`Error creando la instancia: ${error.message}${error.details ? ` — ${error.details}` : ''}`);
          process.exit(1);
        }
        if (result.alreadyExisted) console.log(`La instancia '${name}' ya existía en Evolution — se re-aplicó el webhook.`);
        else console.log(`Instancia '${name}' creada en Evolution (${result.evolutionStatus}).`);

        let qr = result.qr;
        if (!qr) qr = await linking.fetchQr(name, phoneNumber, { attempts: 6 });
        printQr(name, qr);

        if (qr && !qr.alreadyOpen) {
          const ok = await waitForOpen(linking, name);
          if (!ok) break;
        }
        await WhatsAppInstance.updateOne({ name }, { status: 'connected' });
        console.log(`Línea '${name}' marcada como connected. Queda en rotación (enabled=true) en ≤60s. Recordá el warm-up antes de prender el canal.`);
        break;
      }

      case 'qr': {
        const [name, phoneNumber] = args;
        if (!name) {
          console.log('Uso: node scripts/whatsappInstances.js qr <name> [+549...]');
          process.exit(1);
        }
        const linking = requireEvolutionEnv();
        try {
          printQr(name, await linking.fetchQr(name, phoneNumber, { attempts: 6 }));
        } catch (error) {
          console.log(`Error: ${error.message}`);
          process.exit(1);
        }
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
        console.log(`Para vincularla contra Evolution: node scripts/whatsappInstances.js link ${name}`);
        break;
      }

      case 'status': {
        const [name, status] = args;
        if (!name || !INSTANCE_STATUSES.includes(status)) {
          console.log(`Uso: node scripts/whatsappInstances.js status <name> <${INSTANCE_STATUSES.join('|')}>`);
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
        console.log(`Comando desconocido: ${command} (list|link|qr|add|status|enable|disable|channel)`);
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
