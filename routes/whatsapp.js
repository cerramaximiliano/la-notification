const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { verifyServiceToken } = require('../middleware/auth');
const otp = require('../services/channels/whatsapp/otp');

/**
 * Endpoints internos del canal WhatsApp, para el hub (law-analytics-server).
 *
 * Auth: Bearer INTERNAL_SERVICE_TOKEN (el mismo token M2M que ya usan los
 * workers y el hub entre sí — fail-closed si no está configurado de este lado).
 * El webhook inbound de Evolution NO va acá (tiene su propia verificación por
 * apikey y vive en routes/whatsappWebhook.js — Milestone 3).
 */

/**
 * GET /api/whatsapp/availability?user_id=...
 * → { success, available, reason }  reason: channel_disabled | not_configured | no_instance | daily_limit
 */
router.get('/availability', verifyServiceToken, async (req, res) => {
  try {
    const { available, reason } = await otp.checkAvailability(req.query.user_id || null);
    return res.json({ success: true, available, reason: reason || null });
  } catch (error) {
    logger.error(`[whatsapp] availability: ${error.message}`);
    return res.status(500).json({ success: false, available: false, reason: 'error' });
  }
});

/**
 * POST /api/whatsapp/send-otp
 * Body: { user_id, phone (E.164), code }
 * 200 { success:true, provider_message_id }
 * 503 { success:false, reason, message }   canal no disponible ahora (ver availability)
 * 502 { success:false, reason:'provider_error' }  Evolution rechazó/falló el envío
 */
router.post('/send-otp', verifyServiceToken, async (req, res) => {
  const { user_id: userId, phone, code } = req.body || {};
  if (!userId || !phone || !code) {
    return res.status(400).json({ success: false, message: 'Se requieren user_id, phone y code' });
  }

  try {
    const result = await otp.sendOtp({ userId, to: phone, code });
    return res.json({ success: true, provider_message_id: result.providerMessageId });
  } catch (error) {
    if (error.unavailable) {
      return res.status(503).json({ success: false, reason: error.reason, message: error.message });
    }
    // El detalle ya quedó en el log del provider; acá no se loguea el código nunca.
    logger.error(`[whatsapp] send-otp falló para userId=${userId}: ${error.message}`);
    return res.status(502).json({ success: false, reason: 'provider_error', message: 'No se pudo enviar el código por WhatsApp' });
  }
});

module.exports = router;
