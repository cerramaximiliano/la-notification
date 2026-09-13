const crypto = require('crypto');
const moment = require('moment-timezone');
const logger = require('../../../config/logger');
const { WhatsAppOutbox, NotificationLog } = require('../../../models');
const { isConfigured } = require('../../../config/evolution');
const policyService = require('../../notificationPolicyService');
const provider = require('./providers/evolutionApi.provider');
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
// Evolution API, no entre las que quedan "esperando instancia".
const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 8000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => sleep(MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)));

// La clave de idempotencia tiene que identificar ESTA corrida del digest, no
// solo "un digest de este usuario" — por eso depende del conjunto de
// entidades (movimientos) incluidas, no de un entityId fijo. Con un
// entityId constante (ej. null en todos los digests), la clave da siempre
// igual y enqueue() nunca vuelve a encolar nada para ese usuario después del
// primer envío (bug real, corregido acá: ver services/channels/whatsapp/index.js).
function buildIdempotencyKey(userId, entityType, entityIds, messageType) {
  const idsPart = Array.isArray(entityIds) && entityIds.length > 0
    ? [...entityIds].map(String).sort().join(',')
    : 'none';
  return crypto
    .createHash('md5')
    .update(`${userId}:${entityType}:${idsPart}:${messageType}`)
    .digest('hex');
}

/**
 * Encola un mensaje. Idempotente: si ya existe un doc con la misma clave
 * (mismo usuario + mismo conjunto de entidades + tipo de mensaje) no crea
 * uno nuevo — evita duplicados si el cron que arma el digest se solapa o
 * reintenta sobre el mismo lote de movimientos.
 *
 * No resuelve todavía qué línea lo manda — eso pasa recién al procesar (ver
 * processPending), para no fijar una instancia que puede no existir aún.
 *
 * @param {Array<string>} entityIds IDs de las entidades incluidas en este
 *   mensaje (ej. los `_id` de los JudicialMovement del digest) — determina
 *   la idempotencia. `entityId` queda como referencia informativa (primera
 *   entidad, o null si no aplica).
 * @returns {Promise<{ doc: Object, created: boolean }>} `created:false` cuando
 *   ya existía — el caller no debe volver a registrar auditoría en ese caso.
 */
async function enqueue({ userId, to, text, entityType, entityId = null, entityIds = [], messageType = 'judicial_movement_digest' }) {
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
      status: 'pending',
      nextAttemptAt: new Date(),
    });
    return { doc, created: true };
  } catch (error) {
    // Carrera entre dos enqueue simultáneos con la misma clave: el índice
    // unique gana, y el segundo simplemente devuelve el que ya quedó.
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

// Un 4xx que no sea 429 es un problema del mensaje/destinatario (número sin
// WhatsApp, instancia inexistente, payload inválido): reintentar no lo
// arregla y solo gasta intentos. Todo lo demás (red, 5xx, 429) sí se reintenta.
function isPermanentError(error) {
  const status = error?.response?.status;
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 429;
}

async function markFailedAttempt(doc, error) {
  doc.attempts += 1;
  doc.failureReason = error?.response?.data ? JSON.stringify(error.response.data) : (error.message || String(error));

  if (doc.attempts >= MAX_ATTEMPTS || isPermanentError(error)) {
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

// Enviados hoy (ART) por una instancia — incluye digests y OTPs (otp.js los
// registra acá mismo ya como 'sent'), para respetar WhatsAppInstance.dailyLimit.
async function countSentToday(instanceName) {
  const startOfDay = moment.tz(TIMEZONE).startOf('day').toDate();
  return WhatsAppOutbox.countDocuments({
    instanceName,
    status: { $in: ['sent', 'delivered', 'read'] },
    sentAt: { $gte: startOfDay },
  });
}

// Memoizado por tick: una consulta por instancia por corrida.
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
// puede tardar más que eso. Sin esto, dos corridas simultáneas toman los
// mismos `pending` y el usuario recibe el mismo WhatsApp dos veces. Alcanza
// porque la-notification es UN proceso PM2 (fork); si algún día corre en
// cluster, esto pasa a ser un lock en Mongo (claim atómico del doc).
let running = false;
let warnedNotConfigured = false;

/**
 * Drena los `pending` cuyo `nextAttemptAt` ya pasó. Pensado para correr cada
 * 1-2 min vía config/cron.js — nunca debe tirar (cada fila se procesa en su
 * propio try/catch, un fallo no frena al resto del lote).
 *
 * Si todavía no hay ninguna instancia de WhatsApp activa (`WhatsAppInstance`
 * vacía o sin ninguna `connected`) o Evolution API no está configurada, los
 * mensajes quedan `pending` sin gastar intentos — es exactamente el estado
 * esperado mientras no exista la línea todavía, no un error. Lo que sí
 * vence: más de MAX_AGE_HOURS pending → 'expired'.
 *
 * Entre cada envío real (no entre los que quedan esperando) hay un delay
 * aleatorio de 3-8s — con `batchSize` default esto acota un lote a ~1-3
 * minutos, evitando un burst de mensajes en el mismo segundo.
 *
 * Semántica at-least-once: si el proceso muere entre el envío y markSent, el
 * doc sigue pending y se reintenta. Es raro y preferible a perder avisos.
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
    // Kill-switch editable en caliente (status.whatsappEnabled del config doc):
    // apagado → nada sale, lo encolado espera. La expiración sigue corriendo.
    const channelEnabled = policyService.isWhatsappEnabled(await policyService.getConfigCached());
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

      if (!isConfigured()) {
        if (!warnedNotConfigured) {
          logger.warn('WhatsApp outbox: hay mensajes pendientes pero Evolution API no está configurada (EVOLUTION_API_URL/EVOLUTION_API_KEY)');
          warnedNotConfigured = true;
        }
        summary.waiting += 1;
        continue;
      }

      // Instancia: la que ya tenía fijada si sigue activa; si no (se
      // desactivó/baneó en el medio), se reasigna. Sin ninguna activa, espera.
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

      const limit = Number(instance.dailyLimit) || 0;
      if (limit > 0 && (await sentToday(instance.name)) >= limit) {
        summary.waiting += 1;
        continue; // esta línea ya llegó a su tope de hoy; el mensaje sigue pending
      }

      if (attempted > 0) {
        await randomDelay();
      }
      attempted += 1;

      try {
        const result = await provider.sendMessage(instance.name, doc.to, doc.text);
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
      logger.debug(line); // solo "esperando" — no llenar el log cada 2 min mientras no haya línea
    }

    return summary;
  } finally {
    running = false;
  }
}

module.exports = { enqueue, processPending, countSentToday };
