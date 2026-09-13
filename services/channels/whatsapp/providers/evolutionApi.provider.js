const crypto = require('crypto');
const { client, isConfigured } = require('../../../../config/evolution');
const logger = require('../../../../config/logger');

// Evolution API espera el número sin el "+" en /message/sendText.
function toEvolutionNumber(e164) {
  return String(e164 || '').replace(/^\+/, '');
}

/**
 * @param {string} instanceName Nombre de la instancia/línea (models/WhatsAppInstance.js)
 * @param {string} to           Teléfono E.164 del destinatario
 * @param {string} text         Texto ya renderizado
 */
async function sendMessage(instanceName, to, text) {
  if (!isConfigured()) {
    throw new Error('Evolution API no configurada (faltan EVOLUTION_API_URL/EVOLUTION_API_KEY)');
  }
  if (!instanceName) {
    throw new Error('sendMessage requiere instanceName — no hay ninguna instancia de WhatsApp activa (models/WhatsAppInstance.js)');
  }

  try {
    const response = await client.post(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      number: toEvolutionNumber(to),
      text,
    });

    const providerMessageId = response.data?.key?.id || null;
    logger.info(`WhatsApp enviado a ${to} desde instancia '${instanceName}' (providerMessageId: ${providerMessageId || 'sin-id'})`);
    return { providerMessageId, status: 'sent' };
  } catch (error) {
    const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`Error enviando WhatsApp a ${to} desde instancia '${instanceName}': ${detail}`);
    throw error;
  }
}

// Evolution API manda webhooks con forma { event, instance, data, apikey, ... }.
// Eventos que nos importan: 'messages.upsert' (inbound — incluye el eco de lo
// que enviamos si fromMe=true, hay que filtrarlo), 'messages.update' (estado:
// DELIVERY_ACK/READ/...) y 'connection.update' (la línea se cayó/volvió —
// sirve para sacar una instancia de rotación sola). `instance` identifica de
// qué línea vino, importante ahora que puede haber varias. Según la config
// el nombre del evento puede venir como MESSAGES_UPSERT o messages.upsert.
function normalizeEvent(event) {
  return String(event || '').toLowerCase().replace(/_/g, '.');
}

function extractInboundText(message = {}) {
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    null
  );
}

// Solo chats individuales: grupos (@g.us) y broadcast no son un usuario
// respondiendo — un "BAJA" en un grupo no puede dar de baja a nadie.
function isDirectChat(remoteJid) {
  return typeof remoteJid === 'string' && remoteJid.endsWith('@s.whatsapp.net');
}

// "5491155555555@s.whatsapp.net" → "+5491155555555" (lo que guarda User.phone)
function jidToE164(remoteJid) {
  if (!isDirectChat(remoteJid)) return null;
  return `+${remoteJid.split('@')[0].split(':')[0]}`;
}

function parseWebhook(body = {}) {
  const events = [];
  const event = normalizeEvent(body.event);
  const instance = body.instance || null;
  const data = body.data;
  if (!data) return events;

  const dataItems = Array.isArray(data) ? data : [data];

  for (const item of dataItems) {
    if (event === 'messages.upsert') {
      if (item.key?.fromMe) continue;
      if (!isDirectChat(item.key?.remoteJid)) continue;
      const text = extractInboundText(item.message);
      if (text === null) continue;
      events.push({
        providerMessageId: item.key?.id || null,
        status: 'received',
        type: 'message',
        from: item.key?.remoteJid,
        fromPhone: jidToE164(item.key?.remoteJid),
        instance,
        text,
      });
    } else if (event === 'messages.update') {
      const statusMap = { DELIVERY_ACK: 'delivered', READ: 'read', SERVER_ACK: 'sent', ERROR: 'failed', PLAYED: 'read' };
      events.push({
        providerMessageId: item.keyId || item.key?.id || null,
        status: statusMap[item.status] || 'sent',
        type: 'status',
        from: item.remoteJid || item.key?.remoteJid || null,
        fromPhone: jidToE164(item.remoteJid || item.key?.remoteJid),
        instance,
        text: null,
      });
    } else if (event === 'connection.update') {
      // state: 'open' | 'close' | 'connecting'
      events.push({
        providerMessageId: null,
        status: item.state === 'open' ? 'connected' : 'disconnected',
        type: 'connection',
        from: null,
        fromPhone: null,
        instance,
        text: item.statusReason != null ? String(item.statusReason) : null,
      });
    }
  }

  return events;
}

// Fail-closed: sin EVOLUTION_WEBHOOK_APIKEY el webhook rechaza todo. Un
// webhook abierto permitiría fabricar "BAJA"s (dar de baja usuarios ajenos)
// o confirmaciones de opt-in falsas.
function verifyWebhook(req) {
  const expected = process.env.EVOLUTION_WEBHOOK_APIKEY;
  if (!expected) {
    logger.error('EVOLUTION_WEBHOOK_APIKEY no configurada — webhook de WhatsApp rechazado');
    return false;
  }
  const provided = req.headers?.['apikey'] || req.body?.apikey;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { sendMessage, parseWebhook, verifyWebhook, jidToE164 };
