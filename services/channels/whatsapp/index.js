const logger = require('../../../config/logger');
const { NotificationLog } = require('../../../models');
const { expedienteLabel } = require('../../templateProcessor');
const policyService = require('../../notificationPolicyService');
const { buildMovementDigestText, buildMovementDigestTemplateParams } = require('./templates');
const outbox = require('./outbox');

// Movimientos por los que YA se intentó un WhatsApp (cualquier estado). Es el
// criterio propio del canal para "ya lo notifiqué" — independiente de
// JudicialMovement.notificationStatus, que lo marca el email y no se toca.
async function findAlreadyAttemptedIds(userId, ids, entityType = 'judicial_movement') {
  if (ids.length === 0) return new Set();
  const logs = await NotificationLog.find({
    userId,
    entityType,
    'notification.method': 'whatsapp',
    entityId: { $in: ids },
  }).select('entityId').lean();
  return new Set(logs.map(l => String(l.entityId)));
}

// Aplana { key: { expediente, <field>: [...] } } a [{ key, expediente, item }].
function flatten(byExpediente, field) {
  return Object.entries(byExpediente || {})
    .flatMap(([key, data]) => (data?.[field] || [])
      .filter(item => item && item._id)
      .map(item => ({ key, expediente: data.expediente, item })));
}

function regroup(list, field) {
  const out = {};
  for (const { key, expediente, item } of list) {
    if (!out[key]) out[key] = { expediente, [field]: [] };
    out[key][field].push(item);
  }
  return out;
}

/**
 * Punto de entrada único del canal WhatsApp para el digest de movimientos.
 * NO envía nada directamente: arma el texto (y su versión plantilla para
 * Meta), lo encola en WhatsAppOutbox y deja un NotificationLog por movimiento.
 * Se autoprotege: kill-switch + descarta lo ya intentado por este canal.
 *
 * @returns {Promise<{ skipped: boolean, reason?: string, created?: boolean, outboxId?: string }>}
 */
async function sendJudicialMovementDigest({ userId, to, movementsByExpediente, cedulasByExpediente = {}, folderNameByExpediente }) {
  if (!policyService.isWhatsappEnabled(await policyService.getConfigCached())) {
    return { skipped: true, reason: 'channel_disabled' };
  }

  // Movimientos y cédulas del lote, menos lo que este canal ya intentó.
  const allMovements = flatten(movementsByExpediente, 'movements');
  const allCedulas = flatten(cedulasByExpediente, 'cedulas');
  const [attemptedMov, attemptedCed] = await Promise.all([
    findAlreadyAttemptedIds(userId, allMovements.map(x => x.item._id), 'judicial_movement'),
    findAlreadyAttemptedIds(userId, allCedulas.map(x => x.item._id), 'judicial_cedula'),
  ]);
  const freshMovements = allMovements.filter(x => !attemptedMov.has(String(x.item._id)));
  const freshCedulas = allCedulas.filter(x => !attemptedCed.has(String(x.item._id)));

  if (freshMovements.length === 0 && freshCedulas.length === 0) {
    return { skipped: true, reason: allMovements.length + allCedulas.length === 0 ? 'no_movements' : 'already_attempted' };
  }

  const filteredByExpediente = regroup(freshMovements, 'movements');
  const filteredCedulas = regroup(freshCedulas, 'cedulas');

  const text = buildMovementDigestText(filteredByExpediente, { folderNameByExpediente, cedulasByExpediente: filteredCedulas });
  if (!text) {
    return { skipped: true, reason: 'no_movements' };
  }
  const templateParams = buildMovementDigestTemplateParams(filteredByExpediente, { folderNameByExpediente, cedulasByExpediente: filteredCedulas });

  const entityIds = [...freshMovements, ...freshCedulas].map(({ item }) => item._id);

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
    const toLog = [
      ...freshMovements.map(x => ({ ...x, entityType: 'judicial_movement' })),
      ...freshCedulas.map(x => ({ ...x, entityType: 'judicial_cedula' })),
    ];
    for (const { expediente, item, entityType } of toLog) {
      try {
        await NotificationLog.createFromEntity(entityType, item, {
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
            expediente: expedienteLabel(item.expediente || expediente),
          },
        }, userId);
      } catch (logError) {
        logger.error(`Error creando NotificationLog de WhatsApp para ${entityType} ${item._id}: ${logError.message}`);
      }
    }
  }

  return { skipped: false, created, outboxId: String(outboxDoc._id) };
}

module.exports = { sendJudicialMovementDigest };
