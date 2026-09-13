const logger = require('../../../config/logger');
const { NotificationLog } = require('../../../models');
const { expedienteLabel } = require('../../templateProcessor');
const policyService = require('../../notificationPolicyService');
const { buildMovementDigestText } = require('./templates');
const outbox = require('./outbox');

// Movimientos por los que YA se intentó un WhatsApp (cualquier estado: si
// salió no se repite; si venció, la novedad ya es vieja; si falló por
// número inválido, reintentar no ayuda). Es el criterio propio del canal
// para "ya lo notifiqué" — independiente de JudicialMovement.notificationStatus,
// que lo marca el email y no se toca.
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
 * Punto de entrada único del canal WhatsApp. Por ahora solo soporta el
 * digest de movimientos judiciales (lo que se pidió primero); otros tipos de
 * notificación (tareas, calendario, inactividad) se agregan acá mismo el día
 * que se necesiten, siguiendo el mismo patrón.
 *
 * NO envía nada directamente: arma el texto, lo encola en WhatsAppOutbox (lo
 * despacha el cron de config/cron.js) y deja un NotificationLog por
 * movimiento — igual que el email — con status:'created' y
 * delivery.outboxId; el outbox los pasa a sent/failed cuando procesa.
 *
 * Se autoprotege: respeta el kill-switch del canal y descarta los
 * movimientos que ya tuvieron un intento por WhatsApp, así que el caller
 * puede pasarle el mismo `movementsByExpediente` que usa el email sin
 * preocuparse por re-notificar.
 *
 * Todavía no está enganchado a services/notifications.js (eso es el
 * milestone siguiente) — este módulo se puede probar de forma aislada.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.to               Teléfono E.164 verificado del usuario
 * @param {Object} params.movementsByExpediente Misma forma que arma services/notifications.js
 * @param {Object.<string,string>} [params.folderNameByExpediente]
 * @returns {Promise<{ skipped: boolean, reason?: string, created?: boolean, outboxId?: string }>}
 */
async function sendJudicialMovementDigest({ userId, to, movementsByExpediente, folderNameByExpediente }) {
  if (!policyService.isWhatsappEnabled(await policyService.getConfigCached())) {
    return { skipped: true, reason: 'channel_disabled' };
  }

  // Aplanar y descartar lo ya intentado por este canal.
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

  // Los ids del lote determinan la idempotencia (mismo lote = mismo mensaje,
  // no se duplica; un lote distinto SÍ genera un envío nuevo).
  const entityIds = fresh.map(({ movement }) => movement._id);

  const { doc: outboxDoc, created } = await outbox.enqueue({
    userId,
    to,
    text,
    entityType: 'judicial_movement',
    entityIds,
    messageType: 'judicial_movement_digest',
  });

  // Solo la primera vez: si enqueue deduplicó, la auditoría ya existe.
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
