const crypto = require('crypto');
const logger = require('../config/logger');
const { User, WhatsAppOutbox, WhatsAppInstance, NotificationLog } = require('../models');
const policyService = require('../services/notificationPolicyService');
const provider = require('../services/channels/whatsapp/providers/evolutionApi.provider');
const instances = require('../services/channels/whatsapp/instances');
const { buildOptOutConfirmationText, buildAutoReplyText } = require('../services/channels/whatsapp/templates');

/**
 * Webhook inbound de Evolution API (patrón de controllers/sesEventsController.js):
 * cada evento se procesa en su propio try/catch y la respuesta es SIEMPRE 200
 * (salvo la verificación de apikey, que hace la ruta) — si respondiéramos error,
 * Evolution reintenta y encola.
 *
 * Eventos:
 *  - status  → sent/delivered/read/failed del mensaje (WhatsAppOutbox + NotificationLog,
 *              correlacionados por providerMessageId, igual que sesMessageId en SES).
 *  - message → texto de un usuario. "BAJA"/"STOP"/... da de baja el canal al instante
 *              (siempre, aunque el canal esté apagado — la baja nunca puede fallar);
 *              cualquier otro texto de un usuario conocido recibe una respuesta
 *              automática como mucho una vez por día. Números desconocidos: se ignoran
 *              (responderle a desconocidos es exactamente lo que hace un spammer).
 *  - connection → la línea se cayó/volvió: actualiza WhatsAppInstance.status para
 *              sacarla/devolverla a rotación sin intervención manual.
 *
 * Escritura sobre `usuarios` desde este servicio: SOLO la baja (revokedAt +
 * channels.whatsapp=false). El resto de la identidad la escribe el hub.
 */

const OPT_OUT_KEYWORDS = new Set(['BAJA', 'STOP', 'CANCELAR', 'SALIR', 'DESUSCRIBIR', 'UNSUBSCRIBE', 'NO MAS', 'BASTA']);
const AUTO_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // sin acentos
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isOptOut(text) {
  const norm = normalizeText(text);
  return OPT_OUT_KEYWORDS.has(norm) || /^(BAJA|STOP)\b/.test(norm);
}

async function updateLogsByProviderMessageId(providerMessageId, changes) {
  const res = await NotificationLog.updateMany(
    { 'notification.delivery.providerMessageId': providerMessageId, 'notification.method': 'whatsapp' },
    changes
  );
  return res.modifiedCount;
}

// ---------- status ----------
async function handleStatus(event) {
  const { providerMessageId, status } = event;
  if (!providerMessageId) return;

  const doc = await WhatsAppOutbox.findOne({ providerMessageId });
  if (!doc) {
    logger.debug(`WhatsApp status ${status} para providerMessageId desconocido ${providerMessageId}`);
    return;
  }

  const now = new Date();
  if (status === 'delivered' && !doc.deliveredAt) {
    doc.deliveredAt = now;
    if (doc.status === 'sent') doc.status = 'delivered';
    await doc.save();
    await updateLogsByProviderMessageId(providerMessageId, {
      $set: { 'notification.status': 'delivered', 'notification.delivery.deliveredAt': now },
    });
    logger.info(`WhatsApp entregado (${providerMessageId}, outbox ${doc._id})`);
  } else if (status === 'read' && !doc.readAt) {
    doc.readAt = now;
    if (!doc.deliveredAt) doc.deliveredAt = now;
    if (['sent', 'delivered'].includes(doc.status)) doc.status = 'read';
    await doc.save();
    // NotificationLog no tiene status 'read': queda delivered y la lectura va a
    // engagement (es una lectura real, no una apertura de píxel sobre-contada).
    await updateLogsByProviderMessageId(providerMessageId, {
      $set: {
        'notification.status': 'delivered',
        'notification.delivery.deliveredAt': doc.deliveredAt,
        'notification.engagement.lastOpenAt': now,
      },
      $min: { 'notification.engagement.firstOpenAt': now },
    });
  } else if (status === 'failed' && doc.status !== 'failed') {
    doc.status = 'failed';
    doc.failureReason = 'El provider reportó error de entrega (messages.update ERROR)';
    await doc.save();
    await updateLogsByProviderMessageId(providerMessageId, {
      $set: { 'notification.status': 'failed', 'notification.delivery.failureReason': doc.failureReason },
    });
    logger.warn(`WhatsApp falló en entrega (${providerMessageId}, outbox ${doc._id})`);
  }
}

// ---------- message ----------
async function recordReply({ userId, to, instanceName, text, providerMessageId, kind }) {
  try {
    await WhatsAppOutbox.create({
      userId,
      idempotencyKey: `${kind}:${crypto.randomUUID()}`,
      to,
      text,
      messageType: kind,
      entityType: 'auto_reply',
      instanceName,
      status: 'sent',
      providerMessageId: providerMessageId || null,
      attempts: 1,
      sentAt: new Date(),
    });
  } catch (error) {
    logger.warn(`No se pudo registrar la respuesta automática (${kind}) a ${to}: ${error.message}`);
  }
}

async function reply({ user, instanceName, text, kind }) {
  // Sin canal habilitado o sin instancia configurada no se responde nada —
  // pero el caller ya persistió lo importante (la baja) antes de llegar acá.
  if (!policyService.isWhatsappEnabled(await policyService.getConfigCached())) return false;
  const instance = (instanceName && await instances.findActive(instanceName)) || await instances.resolveForUser(user._id);
  if (!instance) return false;
  try {
    const result = await provider.sendMessage(instance.name, user.phone, text);
    await recordReply({ userId: user._id, to: user.phone, instanceName: instance.name, text, providerMessageId: result.providerMessageId, kind });
    return true;
  } catch (error) {
    logger.warn(`No se pudo responder (${kind}) a ${user.phone}: ${error.message}`);
    return false;
  }
}

async function optOut(user, event) {
  const now = new Date();
  await User.updateOne(
    { _id: user._id },
    { $set: { 'whatsappOptIn.revokedAt': now, 'preferences.notifications.channels.whatsapp': false } }
  );
  // Nada de lo encolado puede salir después de una baja.
  const expired = await WhatsAppOutbox.updateMany(
    { userId: user._id, status: 'pending' },
    { $set: { status: 'expired', expiredAt: now, failureReason: 'Baja del usuario por WhatsApp' } }
  );
  try {
    await NotificationLog.createFromEntity('custom', { _id: user._id }, {
      method: 'whatsapp',
      status: 'sent',
      content: { message: `Baja por chat: "${String(event.text).slice(0, 80)}"`, template: 'whatsapp_opt_out' },
      delivery: { recipientPhone: user.phone, providerMessageId: event.providerMessageId || null, attempts: 0 },
      metadata: { source: 'webhook', custom: { instance: event.instance } },
    }, user._id);
  } catch (error) {
    logger.warn(`No se pudo registrar la baja de ${user._id}: ${error.message}`);
  }
  logger.info(`Baja de WhatsApp por chat: userId=${user._id} (${expired.modifiedCount} pendiente(s) descartado(s))`);
  await reply({ user, instanceName: event.instance, text: buildOptOutConfirmationText(), kind: 'opt_out_reply' });
}

async function autoReply(user, event) {
  const since = new Date(Date.now() - AUTO_REPLY_COOLDOWN_MS);
  const recent = await WhatsAppOutbox.exists({ userId: user._id, messageType: 'auto_reply', sentAt: { $gte: since } });
  if (recent) {
    logger.debug(`Auto-reply omitida para userId=${user._id}: ya se respondió en las últimas 24h`);
    return;
  }
  await reply({ user, instanceName: event.instance, text: buildAutoReplyText(user.name?.split(' ')[0]), kind: 'auto_reply' });
}

async function handleMessage(event) {
  if (!event.fromPhone || !event.text) return;

  const user = await User.findOne({ phone: event.fromPhone }).select('_id name phone whatsappOptIn preferences.notifications.channels').lean();
  if (!user) {
    logger.debug(`WhatsApp inbound de un número que no es usuario (${event.fromPhone}) — ignorado`);
    return;
  }

  if (isOptOut(event.text)) {
    await optOut(user, event);
  } else {
    await autoReply(user, event);
  }
}

// ---------- connection ----------
// statusReason de Baileys: 401 loggedOut (hay que re-vincular), 403 forbidden
// (típicamente baneo), 408/428/440/515 caídas transitorias o reinicio.
function statusFromConnection(event) {
  if (event.status === 'connected') return 'connected';
  return String(event.text) === '403' ? 'banned' : 'disconnected';
}

async function handleConnection(event) {
  if (!event.instance) return;
  const status = statusFromConnection(event);
  const res = await WhatsAppInstance.updateOne(
    { name: event.instance },
    { $set: { status, lastConnectionChange: new Date(), lastConnectionReason: event.text || null } }
  );
  instances.invalidateCache();
  if (res.matchedCount === 0) {
    logger.warn(`connection.update de una instancia no registrada: '${event.instance}' (${status})`);
    return;
  }
  const log = status === 'connected' ? logger.info : logger.warn;
  log(`Instancia WhatsApp '${event.instance}' → ${status}${event.text ? ` (reason ${event.text})` : ''}`);
}

// ---------- entry ----------
exports.handleWebhook = async (req, res) => {
  let events = [];
  try {
    events = provider.parseWebhook(req.body || {});
  } catch (error) {
    logger.error(`Webhook WhatsApp: payload inválido: ${error.message}`);
    return res.status(200).json({ success: false, error: 'payload inválido' });
  }

  for (const event of events) {
    try {
      if (event.type === 'status') await handleStatus(event);
      else if (event.type === 'message') await handleMessage(event);
      else if (event.type === 'connection') await handleConnection(event);
    } catch (error) {
      logger.error(`Webhook WhatsApp: error procesando evento ${event.type}: ${error.message}`);
    }
  }

  return res.status(200).json({ success: true, processed: events.length });
};

// Expuestos para tests
exports._internal = { isOptOut, normalizeText, statusFromConnection };
