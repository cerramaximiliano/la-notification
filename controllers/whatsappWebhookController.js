const crypto = require('crypto');
const axios = require('axios');
const logger = require('../config/logger');
const { User, WhatsAppOutbox, WhatsAppInstance, WhatsAppContact, WhatsAppMessage, NotificationLog } = require('../models');
const policyService = require('../services/notificationPolicyService');
const { sendViaInstance, evolution: evolutionProvider } = require('../services/channels/whatsapp/providers');
const instances = require('../services/channels/whatsapp/instances');
const { resolveAccess } = require('../services/channels/whatsapp/access');
const {
  buildOptOutConfirmationText,
  buildAutoReplyText,
  buildAccessExpiredText,
  buildVerifiedReplyText,
  buildVerificationFailedText,
  VERIFICATION_CODE_RE,
} = require('../services/channels/whatsapp/templates');

/**
 * Procesamiento de eventos inbound del canal, común a los dos webhooks
 * (routes/whatsappWebhook.js = Evolution/Baileys, routes/whatsappMetaWebhook.js
 * = Meta Cloud API). Cada evento en su propio try/catch; los routers responden
 * 200 al provider pase lo que pase.
 *
 *  - status     → sent/delivered/read/failed del mensaje (WhatsAppOutbox +
 *                 NotificationLog por providerMessageId).
 *  - message    → texto de un usuario. Orden: código de verificación
 *                 (VERIFICAR-123456 → lo confirma el hub) → BAJA/STOP (baja al
 *                 instante, siempre) → respuesta automática (una por día).
 *                 Números desconocidos: se ignoran, salvo que traigan un código.
 *                 Cada inbound actualiza WhatsAppContact.lastInboundAt (ventana 24 h).
 *  - connection → (solo Baileys) la línea se cayó/volvió.
 *
 * Escritura sobre `usuarios` desde este servicio: SOLO la baja. La verificación
 * la escribe el hub (POST /api/internal/phone/confirm-inbound).
 */

const OPT_OUT_KEYWORDS = new Set(['BAJA', 'STOP', 'CANCELAR', 'SALIR', 'DESUSCRIBIR', 'UNSUBSCRIBE', 'NO MAS', 'BASTA']);
const AUTO_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const HUB_BASE_URL = (process.env.SERVER_BASE_URL || 'https://server.lawanalytics.app').replace(/\/$/, '');

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isOptOut(text) {
  const norm = normalizeText(text);
  return OPT_OUT_KEYWORDS.has(norm) || /^(BAJA|STOP)\b/.test(norm);
}

function extractVerificationCode(text) {
  const m = VERIFICATION_CODE_RE.exec(String(text || ''));
  return m ? m[1] : null;
}

async function updateLogsByProviderMessageId(providerMessageId, changes) {
  const res = await NotificationLog.updateMany(
    { 'notification.delivery.providerMessageId': providerMessageId, 'notification.method': 'whatsapp' },
    changes
  );
  return res.modifiedCount;
}

// Instancia por la que llegó el evento: Baileys trae el nombre; Meta el phoneNumberId.
async function resolveEventInstance(event) {
  if (event.instance) return WhatsAppInstance.findOne({ name: event.instance }).lean();
  if (event.phoneNumberId) return WhatsAppInstance.findOne({ phoneNumberId: event.phoneNumberId }).lean();
  return null;
}

// Guarda el mensaje entrante (Meta no conserva historial). Idempotente por
// providerMessageId: los reintentos del provider no duplican.
async function storeInbound(event, instance, userId, handledAs) {
  if (!event.fromPhone) return;
  try {
    await WhatsAppMessage.updateOne(
      { provider: instance?.provider || 'baileys', providerMessageId: event.providerMessageId || `${event.fromPhone}:${Date.now()}` },
      {
        $setOnInsert: {
          instanceName: instance?.name || event.instance || null,
          phone: event.fromPhone,
          profileName: event.profileName || undefined,
          text: event.text ?? null,
          media: event.media || undefined,
          receivedAt: event.timestamp || new Date(),
        },
        $set: { ...(userId ? { userId } : {}), handledAs },
      },
      { upsert: true }
    );
  } catch (error) {
    logger.warn(`No se pudo guardar el mensaje entrante de ${event.fromPhone}: ${error.message}`);
  }
}

async function touchContact(event, userId) {
  if (!event.fromPhone) return;
  const $set = { lastInboundAt: event.timestamp || new Date() };
  if (event.profileName) $set.profileName = event.profileName;
  if (event.instance) $set.lastInstanceName = event.instance;
  if (userId) $set.userId = userId;
  await WhatsAppContact.updateOne({ phone: event.fromPhone }, { $set }, { upsert: true }).catch(err =>
    logger.warn(`No se pudo actualizar whatsapp-contacts para ${event.fromPhone}: ${err.message}`)
  );
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
    doc.failureReason = `El provider reportó error de entrega${event.text ? `: ${event.text}` : ''}`;
    await doc.save();
    await updateLogsByProviderMessageId(providerMessageId, {
      $set: { 'notification.status': 'failed', 'notification.delivery.failureReason': doc.failureReason },
    });
    logger.warn(`WhatsApp falló en entrega (${providerMessageId}, outbox ${doc._id})`);
  }
}

// ---------- respuestas ----------
async function recordReply({ userId, to, instance, text, providerMessageId, kind }) {
  try {
    await WhatsAppOutbox.create({
      userId: userId || undefined,
      idempotencyKey: `${kind}:${crypto.randomUUID()}`,
      to,
      text,
      messageType: kind,
      entityType: 'auto_reply',
      instanceName: instance.name,
      provider: instance.provider || 'baileys',
      status: 'sent',
      providerMessageId: providerMessageId || null,
      attempts: 1,
      sentAt: new Date(),
    });
  } catch (error) {
    logger.warn(`No se pudo registrar la respuesta automática (${kind}) a ${to}: ${error.message}`);
  }
}

/**
 * Responde por la instancia que recibió el mensaje (o la asignada al usuario).
 * Las respuestas a mensajes del usuario respetan el kill-switch salvo
 * `ignoreKillSwitch` (verificación: el usuario está esperando la respuesta y
 * es una conversación que él inició — gratis en Meta).
 */
async function reply({ phone, userId, instance, text, kind, ignoreKillSwitch = false }) {
  if (!ignoreKillSwitch && !policyService.isWhatsappEnabled(await policyService.getConfigCached())) return false;
  let target = instance && (await instances.findActive(instance.name));
  if (!target && userId) target = await instances.resolveForUser(userId);
  if (!target) target = (await instances.getActiveInstances())[0] || null;
  if (!target) return false;
  try {
    const result = await sendViaInstance(target, phone, text);
    await recordReply({ userId, to: phone, instance: target, text, providerMessageId: result.providerMessageId, kind });
    return true;
  } catch (error) {
    logger.warn(`No se pudo responder (${kind}) a ${phone}: ${error.message}`);
    return false;
  }
}

// ---------- verificación inbound ----------
async function handleVerification(event, instance, code) {
  let result;
  try {
    const res = await axios.post(
      `${HUB_BASE_URL}/api/internal/phone/confirm-inbound`,
      { phone: event.fromPhone, code },
      { headers: { Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}` }, timeout: 8000, validateStatus: () => true }
    );
    result = { ok: res.status === 200 && res.data?.success === true, status: res.status, data: res.data || {} };
  } catch (error) {
    logger.error(`Verificación inbound: no se pudo contactar el hub (${HUB_BASE_URL}): ${error.message}`);
    result = { ok: false, status: 0, data: {} };
  }

  if (result.ok) {
    const userId = result.data.userId || null;
    await touchContact(event, userId);
    await storeInbound(event, instance, userId, 'verification');
    logger.info(`Teléfono verificado por mensaje entrante: ${event.fromPhone} (userId=${userId})`);
    await reply({ phone: event.fromPhone, userId, instance, text: buildVerifiedReplyText(result.data.firstName || null), kind: 'verification_reply', ignoreKillSwitch: true });
  } else {
    await storeInbound(event, instance, null, 'verification_failed');
    logger.info(`Verificación inbound rechazada para ${event.fromPhone}: ${result.status} ${result.data.code || ''}`);
    await reply({ phone: event.fromPhone, instance, text: buildVerificationFailedText(), kind: 'verification_reply', ignoreKillSwitch: true });
  }
}

// ---------- baja / auto-respuesta ----------
async function optOut(user, event, instance) {
  const now = new Date();
  await User.updateOne(
    { _id: user._id },
    { $set: { 'whatsappOptIn.revokedAt': now, 'preferences.notifications.channels.whatsapp': false } }
  );
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
      metadata: { source: 'webhook', custom: { instance: instance?.name || event.instance || event.phoneNumberId } },
    }, user._id);
  } catch (error) {
    logger.warn(`No se pudo registrar la baja de ${user._id}: ${error.message}`);
  }
  logger.info(`Baja de WhatsApp por chat: userId=${user._id} (${expired.modifiedCount} pendiente(s) descartado(s))`);
  await reply({ phone: user.phone, userId: user._id, instance, text: buildOptOutConfirmationText(), kind: 'opt_out_reply' });
}

// Una respuesta por usuario cada 24 h. Si perdió el acceso (prueba vencida /
// sin plan) se le dice eso — el bot (M9) también corta acá antes de responder.
async function autoReply(user, event, instance) {
  const since = new Date(Date.now() - AUTO_REPLY_COOLDOWN_MS);
  const recent = await WhatsAppOutbox.exists({ userId: user._id, messageType: 'auto_reply', sentAt: { $gte: since } });
  if (recent) {
    logger.debug(`Auto-reply omitida para userId=${user._id}: ya se respondió en las últimas 24h`);
    return;
  }
  const firstName = user.name?.split(' ')[0];
  const access = await resolveAccess(user);
  const text = access.allowed ? buildAutoReplyText(firstName) : buildAccessExpiredText(firstName, { reason: access.reason });
  await reply({ phone: user.phone, userId: user._id, instance, text, kind: 'auto_reply' });
}

async function handleMessage(event) {
  if (!event.fromPhone) return;
  const instance = await resolveEventInstance(event);
  if (instance && !event.instance) event.instance = instance.name;

  const code = extractVerificationCode(event.text);
  if (code) {
    await handleVerification(event, instance, code);
    return;
  }

  const user = await User.findOne({ phone: event.fromPhone }).select('_id name phone whatsappOptIn whatsappTrial featureGrants preferences.notifications.channels').lean();
  await touchContact(event, user?._id || null);

  if (!user) {
    await storeInbound(event, instance, null, 'ignored_unknown');
    logger.debug(`WhatsApp inbound de un número que no es usuario (${event.fromPhone}) — ignorado`);
    return;
  }
  if (!event.text) {
    await storeInbound(event, instance, user._id, 'media'); // bot v2: adjuntos a carpetas
    return;
  }

  if (isOptOut(event.text)) {
    await storeInbound(event, instance, user._id, 'opt_out');
    await optOut(user, event, instance);
  } else {
    await storeInbound(event, instance, user._id, 'auto_reply');
    await autoReply(user, event, instance);
  }
}

// ---------- connection (Baileys) ----------
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
async function processEvents(events) {
  for (const event of events) {
    try {
      if (event.type === 'status') await handleStatus(event);
      else if (event.type === 'message') await handleMessage(event);
      else if (event.type === 'connection') await handleConnection(event);
    } catch (error) {
      logger.error(`Webhook WhatsApp: error procesando evento ${event.type}: ${error.message}`);
    }
  }
}

// Webhook de Evolution (Baileys).
exports.handleWebhook = async (req, res) => {
  let events = [];
  try {
    events = evolutionProvider.parseWebhook(req.body || {});
  } catch (error) {
    logger.error(`Webhook WhatsApp: payload inválido: ${error.message}`);
    return res.status(200).json({ success: false, error: 'payload inválido' });
  }
  await processEvents(events);
  return res.status(200).json({ success: true, processed: events.length });
};

exports.processEvents = processEvents;
exports._internal = { isOptOut, normalizeText, statusFromConnection, extractVerificationCode };
