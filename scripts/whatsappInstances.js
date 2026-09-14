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
const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'];
const WEBHOOK_URL = process.env.WHATSAPP_WEBHOOK_PUBLIC_URL || 'https://notifications.lawanalytics.app/api/whatsapp/webhook';
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function evolutionClient() {
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
    console.log('Faltan EVOLUTION_API_URL y/o EVOLUTION_API_KEY en el entorno (apikey global de Evolution API).');
    process.exit(1);
  }
  const axios = require('axios');
  return axios.create({
    baseURL: process.env.EVOLUTION_API_URL.replace(/\/$/, ''),
    headers: { apikey: process.env.EVOLUTION_API_KEY },
    timeout: 20000,
    validateStatus: () => true,
  });
}

function webhookConfig() {
  const config = { enabled: true, url: WEBHOOK_URL, events: WEBHOOK_EVENTS, base64: false };
  if (process.env.EVOLUTION_WEBHOOK_APIKEY) {
    config.headers = { apikey: process.env.EVOLUTION_WEBHOOK_APIKEY };
  }
  return config;
}

function saveQr(name, base64) {
  if (!base64) return null;
  const data = base64.replace(/^data:image\/\w+;base64,/, '');
  const file = path.resolve(process.cwd(), `whatsapp-qr-${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

function toEvolutionNumber(phone) {
  return phone ? String(phone).replace(/^\+/, '') : undefined;
}

async function fetchQr(api, name, phone) {
  // Evolution puede devolver {count:0} sin QR durante unos segundos (o si la
  // instancia está en un estado raro — ver meta-issue #2437 del repo).
  for (let attempt = 1; attempt <= 8; attempt++) {
    const params = phone ? { number: toEvolutionNumber(phone) } : {};
    const res = await api.get(`/instance/connect/${encodeURIComponent(name)}`, { params });
    if (res.status === 200 && (res.data?.base64 || res.data?.pairingCode || res.data?.code)) {
      return res.data;
    }
    if (res.status === 200 && res.data?.instance?.state === 'open') {
      return { alreadyOpen: true };
    }
    if (attempt < 8) await sleep(3000);
  }
  return null;
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

async function waitForOpen(api, name) {
  const started = Date.now();
  process.stdout.write('Esperando que la línea se conecte (Ctrl+C para salir; se puede marcar `connected` después desde la admin)');
  while (Date.now() - started < CONNECT_TIMEOUT_MS) {
    const res = await api.get(`/instance/connectionState/${encodeURIComponent(name)}`);
    const state = res.data?.instance?.state;
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

async function ensureRegistered(WhatsAppInstance, name, label, phoneNumber) {
  const existing = await WhatsAppInstance.findOne({ name });
  if (existing) return existing;
  const doc = await WhatsAppInstance.create({ name, label, phoneNumber });
  console.log(`Instancia '${name}' registrada en Mongo (pending_link).`);
  return doc;
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
        const api = evolutionClient();
        await ensureRegistered(WhatsAppInstance, name, label || name, phoneNumber);

        const createBody = { instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true, webhook: webhookConfig() };
        if (phoneNumber) createBody.number = toEvolutionNumber(phoneNumber);
        const created = await api.post('/instance/create', createBody);

        let qr = null;
        if (created.status === 201 || created.status === 200) {
          console.log(`Instancia '${name}' creada en Evolution (${created.data?.instance?.status || 'connecting'}).`);
          qr = created.data?.qrcode && (created.data.qrcode.base64 || created.data.qrcode.pairingCode) ? created.data.qrcode : null;
        } else {
          const msg = JSON.stringify(created.data?.error || created.data?.response || created.data || {});
          if (/already|exist|in use|duplicad/i.test(msg) || created.status === 403 || created.status === 409) {
            console.log(`La instancia '${name}' ya existía en Evolution — se re-aplica el webhook.`);
            const wh = await api.post(`/webhook/set/${encodeURIComponent(name)}`, webhookConfig());
            if (wh.status >= 300) console.log(`No se pudo configurar el webhook (${wh.status}): ${JSON.stringify(wh.data)}`);
          } else {
            console.log(`Error creando la instancia (${created.status}): ${msg}`);
            process.exit(1);
          }
        }

        if (!qr) qr = await fetchQr(api, name, phoneNumber);
        printQr(name, qr);

        if (qr && !qr.alreadyOpen) {
          const ok = await waitForOpen(api, name);
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
        const api = evolutionClient();
        printQr(name, await fetchQr(api, name, phoneNumber));
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
