const { client, isConfigured } = require('../../../config/evolution');
const logger = require('../../../config/logger');
const { WhatsAppInstance } = require('../../../models');
const instances = require('./instances');

/**
 * Alta/vinculación de una línea contra Evolution API. Lo usan el script
 * (scripts/whatsappInstances.js link|qr) y los endpoints internos que la
 * admin UI consume vía el hub (routes/whatsapp.js) — las credenciales de
 * Evolution viven solo en este servicio.
 *
 * Flujo: registrar en Mongo (pending_link) → crear la instancia en Evolution
 * (WHATSAPP-BAILEYS) con el webhook ya configurado → QR/pairing code → cuando
 * connectionState es `open`, la línea pasa a `connected` (getState lo hace).
 */

const WEBHOOK_URL = process.env.WHATSAPP_WEBHOOK_PUBLIC_URL || 'https://notifications.lawanalytics.app/api/whatsapp/webhook';
const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'];
const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/i;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const enc = (name) => encodeURIComponent(name);
const toEvolutionNumber = (phone) => (phone ? String(phone).replace(/[^\d]/g, '') : undefined);

class LinkingError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'LinkingError';
    this.status = status;
    this.details = details;
  }
}

function webhookConfig() {
  const config = { enabled: true, url: WEBHOOK_URL, events: WEBHOOK_EVENTS, base64: false };
  // Evolution manda estos headers en cada POST del webhook: es lo que verifica
  // routes/whatsappWebhook.js (fail-closed).
  if (process.env.EVOLUTION_WEBHOOK_APIKEY) {
    config.headers = { apikey: process.env.EVOLUTION_WEBHOOK_APIKEY };
  }
  return config;
}

function requireConfigured() {
  if (!isConfigured()) {
    throw new LinkingError(503, 'Evolution API no configurada (EVOLUTION_API_URL/EVOLUTION_API_KEY)');
  }
}

// Nunca lanza por status HTTP: cada caller decide qué hacer con la respuesta.
const evo = (method, url, options = {}) => client.request({ method, url, validateStatus: () => true, ...options });

function pickQr(payload) {
  if (!payload) return null;
  if (payload.base64 || payload.pairingCode) {
    return { base64: payload.base64 || null, pairingCode: payload.pairingCode || null };
  }
  return null;
}

/**
 * @returns {Promise<{ base64: string|null, pairingCode: string|null } | { alreadyOpen: true } | null>}
 *   null = Evolution respondió sin QR ({count:0}) — reintentar en unos segundos
 */
async function fetchQr(name, phoneNumber, { attempts = 1, delayMs = 3000 } = {}) {
  requireConfigured();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await evo('get', `/instance/connect/${enc(name)}`, {
      params: phoneNumber ? { number: toEvolutionNumber(phoneNumber) } : {},
    });
    if (res.status === 404) {
      throw new LinkingError(404, `La instancia '${name}' no existe en Evolution`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new LinkingError(502, 'Evolution rechazó la apikey (EVOLUTION_API_KEY)');
    }
    const qr = res.status === 200 ? pickQr(res.data) : null;
    if (qr) return qr;
    if (res.status === 200 && res.data?.instance?.state === 'open') return { alreadyOpen: true };
    if (attempt < attempts) await sleep(delayMs);
  }
  return null;
}

/**
 * Registra (si hace falta) y crea la instancia en Evolution con el webhook.
 * Si ya existía en Evolution, solo re-aplica el webhook y pide un QR.
 */
async function createInstance({ name, label, phoneNumber }) {
  requireConfigured();
  if (!NAME_RE.test(name || '')) {
    throw new LinkingError(400, 'Nombre de instancia inválido: letras, números, guiones o guión bajo (2 a 40 caracteres)');
  }

  let doc = await WhatsAppInstance.findOne({ name });
  if (!doc) {
    doc = await WhatsAppInstance.create({ name, label: label || name, phoneNumber: phoneNumber || undefined });
    logger.info(`Instancia WhatsApp '${name}' registrada (pending_link)`);
  } else if ((label && label !== doc.label) || (phoneNumber && phoneNumber !== doc.phoneNumber)) {
    await WhatsAppInstance.updateOne({ name }, { $set: { ...(label ? { label } : {}), ...(phoneNumber ? { phoneNumber } : {}) } });
  }

  const body = { instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true, webhook: webhookConfig() };
  if (phoneNumber) body.number = toEvolutionNumber(phoneNumber);

  const created = await evo('post', '/instance/create', { data: body });
  let alreadyExisted = false;
  let evolutionStatus = null;
  let qr = null;

  if (created.status === 201 || created.status === 200) {
    evolutionStatus = created.data?.instance?.status || 'connecting';
    qr = pickQr(created.data?.qrcode);
    logger.info(`Instancia '${name}' creada en Evolution (${evolutionStatus})`);
  } else {
    const detail = JSON.stringify(created.data?.error || created.data?.response || created.data || {});
    if (/already|exist|in use|duplicad/i.test(detail) || created.status === 403 || created.status === 409) {
      alreadyExisted = true;
      const wh = await evo('post', `/webhook/set/${enc(name)}`, { data: webhookConfig() });
      if (wh.status >= 300) {
        logger.warn(`No se pudo re-aplicar el webhook de '${name}' (${wh.status}): ${JSON.stringify(wh.data)}`);
      }
    } else if (created.status === 401) {
      throw new LinkingError(502, 'Evolution rechazó la apikey (EVOLUTION_API_KEY)', detail);
    } else {
      throw new LinkingError(502, `Evolution rechazó la creación de la instancia (${created.status})`, detail);
    }
  }

  if (!qr) qr = await fetchQr(name, phoneNumber, { attempts: 3 });

  return { name, alreadyExisted, evolutionStatus, qr };
}

/**
 * Estado de conexión en Evolution. Si está `open`, deja la línea `connected`
 * en Mongo (y limpia la cache de instancias) — así la vinculación desde la
 * admin no necesita un paso manual extra.
 */
async function getState(name) {
  requireConfigured();
  const res = await evo('get', `/instance/connectionState/${enc(name)}`);
  if (res.status === 404) {
    throw new LinkingError(404, `La instancia '${name}' no existe en Evolution`);
  }
  const state = res.data?.instance?.state || 'unknown';
  if (state === 'open') {
    const result = await WhatsAppInstance.updateOne(
      { name, status: { $ne: 'connected' } },
      { $set: { status: 'connected', lastConnectionChange: new Date(), lastConnectionReason: 'linking' } }
    );
    if (result.modifiedCount > 0) {
      instances.invalidateCache();
      logger.info(`Instancia WhatsApp '${name}' → connected (vinculación)`);
    }
  }
  return { state };
}

module.exports = { createInstance, fetchQr, getState, webhookConfig, LinkingError, WEBHOOK_URL, WEBHOOK_EVENTS };
