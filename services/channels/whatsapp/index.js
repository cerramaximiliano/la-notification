const logger = require('../../../config/logger');
const { NotificationLog } = require('../../../models');
const { expedienteLabel } = require('../../templateProcessor');
const policyService = require('../../notificationPolicyService');
const { buildMovementDigestText, buildMovementDigestTemplateParams } = require('./templates');
const outbox = require('./outbox');

// Movimientos por los que YA se intentó un WhatsApp (cualquier estado). Es el
// criterio propio del canal para "ya lo notifiqué" — independiente de
// JudicialMovement.notificationStatus, que lo marca el email y no se toca.
async function findAlreadyAttemptedIds(userId, movementIds) {
  if (movementIds.length === 0) return new Set();
  const logs = await NotificationLog.find({
    userId,
    entityType: 'judicial_movement',
    'notification.method': 'whatsapp',
    entityId: { $in: movementIds },
  }).select('entityId').lean();
  return new Set(logs.map(l => String(l.entityId)));
}

/**
 * Punto de entrada único del canal WhatsApp para el digest de movimientos.
 * NO envía nada directamente: arma el texto (y su versión plantilla para
 * Meta), lo encola en WhatsAppOutbox y deja un NotificationLog por movimiento.
 * Se autoprotege: kill-switch + descarta lo ya intentado por este canal.
 *
 * @returns {Promise<{ skipped: boolean, reason?: string, created?: boolean, outboxId?: string }>}
 */
async function sendJudicialMovementDigest({ userId, to, movementsByExpediente, folderNameByExpediente }) {
  if (!policyService.isWhatsappEnabled(await policyService.getConfigCached())) {
    return { skipped: true, reason: 'channel_disabled' };
  }

  const all = Object.entries(movementsByExpediente || {})
    .flatMap(([key, data]) => (data?.movements || [])
      .filter(m => m && m._id)
      .map(m => ({ key, expediente: data.expediente, movement: m })));
  const attempted = await findAlreadyAttemptedIds(userId, all.map(x => x.movement._id));
  const fresh = all.filter(x => !attempted.has(String(x.movement._id)));

  if (fresh.length === 0) {
    return { skipped: true, reason: all.length === 0 ? 'no_movements' : 'already_attempted' };
  }

  const filteredByExpediente = {};
  for (const { key, expediente, movement } of fresh) {
    if (!filteredByExpediente[key]) filteredByExpediente[key] = { expediente, movements: [] };
    filteredByExpediente[key].movements.push(movement);
  }

  const text = buildMovementDigestText(filteredByExpediente, { folderNameByExpediente });
  if (!text) {
    return { skipped: true, reason: 'no_movements' };
  }
  const templateParams = buildMovementDigestTemplateParams(filteredByExpediente, { folderNameByExpediente });

  const entityIds = fresh.map(({ movement }) => movement._id);

  const { doc: outboxDoc, created } = await outbox.enqueue({
    userId,
    to,
    text,
    templateParams,
    entityType: 'judicial_movement',
    entityIds,
    messageType: 'judicial_movement_digest',
  });

  if (created) {
    for (const { expediente, movement } of fresh) {
      try {
        await NotificationLog.createFromEntity('judicial_movement', movement, {
          method: 'whatsapp',
          status: 'created',
          content: {
            message: text,
            template: 'whatsapp_judicial_movement_digest',
          },
          delivery: {
            recipientPhone: to,
            outboxId: outboxDoc._id,
            attempts: 0,
          },
          metadata: {
            source: 'cron',
            expediente: expedienteLabel(movement.expediente || expediente),
          },
        }, userId);
      } catch (logError) {
        logger.error(`Error creando NotificationLog de WhatsApp para movimiento ${movement._id}: ${logError.message}`);
      }
    }
  }

  return { skipped: false, created, outboxId: String(outboxDoc._id) };
}

module.exports = { sendJudicialMovementDigest };
