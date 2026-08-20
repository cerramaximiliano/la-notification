const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { PostalNotification } = require('../models');
const authMiddleware = require('../middleware/auth');
const { sendPostalNotification, sendPostalAdminAlert } = require('../services/notifications');

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

/**
 * Webhook de ALERTA OPERATIVA al admin (postal-tracking-service).
 *
 * El manager del servicio postal lo dispara cuando detecta seguimientos
 * activos que su worker no consulta hace más de N horas (kind 'stale') y
 * cuando la condición se normaliza (kind 'recovered'). El anti-spam y la
 * detección viven en el servicio de origen; acá se resuelve configuración
 * (destinatarios, enabled), template y banners, y se envía en el acto.
 *
 * Body: {
 *   kind: 'stale' | 'recovered',
 *   staleAfterHours: Number,
 *   trackings: [{ codeId, numberId, processingStatus, trackingStatus, lastCheckedAt }],
 *   activeSince: Date  // solo en 'recovered'
 * }
 *
 * Respuesta: { success, sent } — el origen usa `sent` para decidir si marca
 * la alerta como notificada o hace fallback a su canal de emergencia (SES
 * directo con HTML plano).
 */
router.post('/webhook/admin-alert', authMiddleware.verifyServiceToken, async (req, res) => {
  try {
    const { kind, staleAfterHours, trackings, activeSince } = req.body || {};

    if (!['stale', 'recovered'].includes(kind)) {
      return res.status(400).json({ success: false, message: "kind debe ser 'stale' o 'recovered'" });
    }
    if (kind === 'stale' && (!Array.isArray(trackings) || trackings.length === 0)) {
      return res.status(400).json({ success: false, message: 'trackings debe ser un array no vacío para kind=stale' });
    }

    const result = await sendPostalAdminAlert({ kind, staleAfterHours, trackings, activeSince });

    return res.json({
      success: result.success === true,
      sent: result.sent === true,
      message: result.message
    });
  } catch (error) {
    logger.error(`[PostalAdminAlert] Error procesando webhook: ${error.message}`);
    return res.status(500).json({ success: false, sent: false, message: error.message });
  }
});

module.exports = router;
