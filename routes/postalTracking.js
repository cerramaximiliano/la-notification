const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { PostalNotification } = require('../models');
const authMiddleware = require('../middleware/auth');
const { sendPostalNotification } = require('../services/notifications');

/**
 * Webhook de eventos de seguimiento postal (postal-tracking-service).
 *
 * A diferencia del webhook de movimientos judiciales (que encola para la
 * entrega consolidada de la tarde), acá el envío es INMEDIATO: se persiste
 * y se intenta enviar en el acto. La respuesta le dice al worker si el
 * email salió, para que marque `notifiedAt` en su propio documento.
 *
 * Si el envío falla, el documento queda 'pending'/'failed' y lo levanta el
 * safe guard diario.
 *
 * Body: {
 *   userId, tracking: { trackingId, codeId, numberId, folderId, folderName, isFinalStatus },
 *   events: [{ sourceEventId, status, deliveryStatus, description, location, eventDate }]
 * }
 */
router.post('/webhook/events', authMiddleware.verifyServiceToken, async (req, res) => {
  try {
    const { userId, tracking, events } = req.body || {};

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId es requerido' });
    }
    if (!tracking || !tracking.trackingId) {
      return res.status(400).json({ success: false, message: 'tracking.trackingId es requerido' });
    }
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, message: 'events debe ser un array no vacío' });
    }

    const uniqueKey = PostalNotification.generateUniqueKey(userId, tracking.trackingId, events);

    // Dedup: si ya se envió este lote exacto, no reenviar.
    const existing = await PostalNotification.findOne({ uniqueKey });
    if (existing && existing.notificationStatus === 'sent') {
      logger.info(`[Postal] Lote ya notificado — skip (uniqueKey: ${uniqueKey})`);
      return res.json({ success: true, sent: true, duplicated: true, message: 'Ya notificado' });
    }

    let notification = existing;
    if (notification) {
      // pending/failed/skipped → refrescar datos y reintentar
      notification.tracking = tracking;
      notification.events = events;
      notification.notificationStatus = 'pending';
      await notification.save();
    } else {
      notification = await PostalNotification.create({
        userId,
        tracking: {
          trackingId: String(tracking.trackingId),
          codeId: tracking.codeId,
          numberId: tracking.numberId,
          folderId: tracking.folderId ? String(tracking.folderId) : undefined,
          folderName: tracking.folderName,
          isFinalStatus: tracking.isFinalStatus === true
        },
        events,
        source: 'webhook',
        uniqueKey,
        notificationStatus: 'pending'
      });
    }

    // Envío inmediato
    const result = await sendPostalNotification({ notification });

    return res.json({
      success: true,
      sent: result.sent === true,
      // El worker solo debe marcar notifiedAt si sent=true. Cuando el envío
      // se omite por preferencia del usuario (skipped) también se considera
      // resuelto: no hay nada que reintentar.
      resolved: result.sent === true || notification.notificationStatus === 'skipped',
      status: notification.notificationStatus,
      message: result.message
    });

  } catch (error) {
    logger.error(`[Postal] Error procesando webhook: ${error.message}`);
    return res.status(500).json({ success: false, sent: false, message: error.message });
  }
});

module.exports = router;
