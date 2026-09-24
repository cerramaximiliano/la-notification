const crypto = require('crypto');
const moment = require('moment-timezone');
const logger = require('../../../config/logger');
const { WhatsAppOutbox, NotificationLog } = require('../../../models');
const { isConfigured: evolutionConfigured } = require('../../../config/evolution');
const { isConfigured: metaConfigured } = require('../../../config/meta');
const policyService = require('../../notificationPolicyService');
const { sendViaInstance, isPermanentSendError } = require('./providers');
const metaTemplates = require('./metaTemplates');
const instances = require('./instances');

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const MAX_ATTEMPTS = 3;
// Backoff simple por intento: 2min / 10min / 30min antes de darlo por failed.
const BACKOFF_MINUTES = [2, 10, 30];
// Un digest pending más viejo que esto no sale nunca: se marca 'expired'.
const MAX_AGE_HOURS = Number(process.env.WHATSAPP_OUTBOX_MAX_AGE_HOURS) || 48;

// Espaciado entre envíos reales al provider (nunca un burst de N mensajes en
// el mismo segundo — ver el análisis de riesgo de baneo del informe
// publicado). Se aplica solo entre llamadas que efectivamente pegan contra
// el provider, no entre las que quedan "esperando instancia".
const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 8000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => sleep(MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)));

// La clave de idempotencia tiene que identificar ESTA corrida del digest, no
// solo "un digest de este usuario" — por eso depende del conjunto de
// entidades (movimientos) incluidas, no de un entityId fijo.
function buildIdempotencyKey(userId, entityType, entityIds, messageType) {
  const idsPart = Array.isArray(entityIds) && entityIds.length > 0
    ? [...entityIds].map(String).sort().join(',')
    : 'none';
  return crypto
    .createHash('md5')
    .update(`${userId}:${entityType}:${idsPart}:${messageType}`)
    .digest('hex');
}

function providerConfigured(instance) {
  return instance?.provider === 'meta' ? metaConfigured() : evolutionConfigured();
}

/**
 * Encola un mensaje. Idempotente: si ya existe un doc con la misma clave
 * (mismo usuario + mismo conjunto de entidades + tipo de mensaje) no crea
 * uno nuevo.
 *
 * @param {Array<string>} entityIds IDs de las entidades incluidas (determinan la idempotencia)
 * @param {Object} [templateParams] versión plantilla del mensaje (Meta fuera de la ventana de 24 h)
 * @returns {Promise<{ doc: Object, created: boolean }>}
 */
async function enqueue({ userId, to, text, entityType, entityId = null, entityIds = [], messageType = 'judicial_movement_digest', templateParams = undefined }) {
  const idempotencyKey = buildIdempotencyKey(userId, entityType, entityIds, messageType);

  const existing = await WhatsAppOutbox.findOne({ idempotencyKey }).lean();
  if (existing) {
    logger.info(`WhatsApp ya encolado para userId=${userId} (idempotencyKey=${idempotencyKey}), no se duplica`);
    return { doc: existing, created: false };
  }

  try {
    const doc = await WhatsAppOutbox.create({
      userId,
      idempotencyKey,
      to,
      text,
      messageType,
      entityType,
      entityId: entityId || entityIds[0] || null,
      templateParams: templateParams || undefined,
      status: 'pending',
      nextAttemptAt: new Date(),
    });
    return { doc, created: true };
  } catch (error) {
    if (error.code === 11000) {
      const raced = await WhatsAppOutbox.findOne({ idempotencyKey }).lean();
      if (raced) return { doc: raced, created: false };
    }
    throw error;
  }
}

// Mantiene sincronizados los NotificationLog que index.js dejó en 'created'
// apuntando a este outbox (uno por movimiento, igual que el email).
async function syncNotificationLogs(doc, changes) {
  try {
    await NotificationLog.updateMany(
      { 'notification.delivery.outboxId': doc._id, 'notification.method': 'whatsapp' },
      { $set: changes }
    );
  } catch (error) {
    logger.warn(`No se pudo actualizar NotificationLog para outbox ${doc._id}: ${error.message}`);
  }
}

async function markSent(doc, { providerMessageId }) {
  doc.status = 'sent';
  doc.providerMessageId = providerMessageId || null;
  doc.sentAt = new Date();
  await doc.save();
  await syncNotificationLogs(doc, {
    'notification.status': 'sent',
    'notification.delivery.providerMessageId': doc.providerMessageId,
    'notification.delivery.lastAttemptAt': doc.sentAt,
    'notification.delivery.attempts': doc.attempts + 1,
    sentAt: doc.sentAt,
  });
}

async function markFailedAttempt(doc, error) {
  doc.attempts += 1;
  doc.failureReason = error?.details ? `${error.message} — ${JSON.stringify(error.details)}`
    : error?.response?.data ? JSON.stringify(error.response.data)
    : (error?.message || String(error));

  if (doc.attempts >= MAX_ATTEMPTS || isPermanentSendError(error)) {
    doc.status = 'failed';
  } else {
    const minutes = BACKOFF_MINUTES[doc.attempts - 1] || BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
    doc.nextAttemptAt = new Date(Date.now() + minutes * 60 * 1000);
  }

  await doc.save();
  await syncNotificationLogs(doc, {
    'notification.status': doc.status === 'failed' ? 'failed' : 'retry',
    'notification.delivery.failureReason': doc.failureReason,
    'notification.delivery.lastAttemptAt': new Date(),
    'notification.delivery.attempts': doc.attempts,
  });
}

async function markExpired(doc) {
  doc.status = 'expired';
  doc.expiredAt = new Date();
  doc.failureReason = `Venció sin poder enviarse (más de ${MAX_AGE_HOURS}h pending)`;
  await doc.save();
  await syncNotificationLogs(doc, {
    'notification.status': 'failed',
    'notification.delivery.failureReason': doc.failureReason,
  });
}

// Enviados hoy (ART) por una instancia — incluye digests, OTPs y respuestas
// automáticas, para respetar WhatsAppInstance.dailyLimit.
async function countSentToday(instanceName) {
  const startOfDay = moment.tz(TIMEZONE).startOf('day').toDate();
  return WhatsAppOutbox.countDocuments({
    instanceName,
    status: { $in: ['sent', 'delivered', 'read'] },
    sentAt: { $gte: startOfDay },
  });
}

async function sentTodayCounter() {
  const counts = new Map();
  return async (instanceName) => {
    if (!counts.has(instanceName)) {
      counts.set(instanceName, await countSentToday(instanceName));
    }
    return counts.get(instanceName);
  };
}

// Guard contra solapamiento: el cron corre cada 2 min y un lote con delays
// puede tardar más que eso. Alcanza porque la-notification es UN proceso PM2
// (fork); en cluster pasaría a ser un claim atómico en Mongo.
let running = false;
let warnedNotConfigured = false;

/**
 * Drena los `pending` cuyo `nextAttemptAt` ya pasó (cron cada 1-2 min). Nunca
 * tira. Sin instancia activa, canal apagado o provider sin configurar → los
 * mensajes esperan sin gastar intentos (vencen a MAX_AGE_HOURS).
 * Semántica at-least-once.
 */
async function processPending(batchSize = 20) {
  if (running) {
    logger.debug('WhatsApp outbox: corrida anterior todavía en curso, se saltea este tick');
    return { processed: 0, sent: 0, failed: 0, waiting: 0, expired: 0, skipped: true };
  }
  running = true;

  const summary = { processed: 0, sent: 0, failed: 0, waiting: 0, expired: 0 };

  try {
    const pending = await WhatsAppOutbox.find({
      status: 'pending',
      nextAttemptAt: { $lte: new Date() },
    })
      .sort({ nextAttemptAt: 1, createdAt: 1 })
      .limit(batchSize);

    summary.processed = pending.length;
    if (pending.length === 0) return summary;

    const expiryCutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);
    const sentToday = await sentTodayCounter();
    const config = await policyService.getConfigCached();
    const channelEnabled = policyService.isWhatsappEnabled(config);
    // Nombres de plantilla vigentes (admin → env). Se resuelven una vez por
    // corrida: todos los envíos del lote usan la misma configuración.
    const templateNames = metaTemplates.resolveNames(config);
    let attempted = 0;

    for (const doc of pending) {
      if (doc.createdAt < expiryCutoff) {
        await markExpired(doc);
        summary.expired += 1;
        continue;
      }

      if (!channelEnabled) {
        summary.waiting += 1;
        continue;
      }

      // Instancia: la fijada si sigue activa; si no, se reasigna. Sin activas, espera.
      let instance = doc.instanceName ? await instances.findActive(doc.instanceName) : null;
      if (!instance) {
        instance = await instances.resolveForUser(doc.userId);
        if (!instance) {
          summary.waiting += 1;
          continue;
        }
        if (doc.instanceName && doc.instanceName !== instance.name) {
          logger.info(`WhatsApp outbox ${doc._id}: instancia '${doc.instanceName}' ya no está activa, se reasigna a '${instance.name}'`);
        }
        doc.instanceName = instance.name;
      }
      doc.provider = instance.provider || 'baileys';

      if (!providerConfigured(instance)) {
        if (!warnedNotConfigured) {
          logger.warn(`WhatsApp outbox: hay mensajes pendientes pero el provider '${doc.provider}' no está configurado`);
          warnedNotConfigured = true;
        }
        summary.waiting += 1;
        continue;
      }

      const limit = Number(instance.dailyLimit) || 0;
      if (limit > 0 && (await sentToday(instance.name)) >= limit) {
        summary.waiting += 1;
        continue;
      }

      if (attempted > 0) {
        await randomDelay();
      }
      attempted += 1;

      try {
        const result = await sendViaInstance(instance, doc.to, doc.text, { templateParams: doc.templateParams, templateNames });
        await markSent(doc, result);
        summary.sent += 1;
      } catch (error) {
        await markFailedAttempt(doc, error);
        summary.failed += 1;
      }
    }

    const line = `WhatsApp outbox: procesados ${summary.processed} (sent=${summary.sent}, failed/retry=${summary.failed}, expired=${summary.expired}, esperando=${summary.waiting})`;
    if (summary.sent + summary.failed + summary.expired > 0) {
      logger.info(line);
    } else {
      logger.debug(line);
    }

    return summary;
  } finally {
    running = false;
  }
}

module.exports = { enqueue, processPending, countSentToday };
