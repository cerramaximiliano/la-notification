const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { verifyServiceToken } = require('../middleware/auth');
const otp = require('../services/channels/whatsapp/otp');
const linking = require('../services/channels/whatsapp/linking');

function replyLinkingError(res, error, context) {
  if (error && error.status) {
    return res.status(error.status).json({ success: false, message: error.message, details: error.details || null });
  }
  logger.error(`[whatsapp] ${context}: ${error.message}`);
  return res.status(500).json({ success: false, message: `Error en ${context}` });
}

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

/**
 * Vinculación de líneas (lo consume la admin UI vía el hub — las credenciales
 * de Evolution no salen de este servicio).
 *
 * POST /api/whatsapp/instances            Body: { name, label?, phone? }
 *   201 { success, data: { name, alreadyExisted, evolutionStatus, qr: {base64, pairingCode}|null } }
 * GET  /api/whatsapp/instances/:name/qr?number=   → { success, data: qr|null }  (null = reintentar)
 * GET  /api/whatsapp/instances/:name/state         → { success, data: { state } }  (open → marca connected)
 * 503 si Evolution no está configurada; 404 si la instancia no existe en Evolution.
 */
router.post('/instances', verifyServiceToken, async (req, res) => {
  const { name, label, phone } = req.body || {};
  if (!name) {
    return res.status(400).json({ success: false, message: 'Se requiere name' });
  }
  try {
    const data = await linking.createInstance({ name: String(name).trim(), label, phoneNumber: phone });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return replyLinkingError(res, error, 'la creación de la instancia');
  }
});

router.get('/instances/:name/qr', verifyServiceToken, async (req, res) => {
  try {
    const qr = await linking.fetchQr(req.params.name, req.query.number || null, { attempts: 2 });
    return res.json({ success: true, data: qr, message: qr ? null : 'Evolution no devolvió QR todavía; reintentar en unos segundos' });
  } catch (error) {
    return replyLinkingError(res, error, 'la obtención del QR');
  }
});

router.get('/instances/:name/state', verifyServiceToken, async (req, res) => {
  try {
    const data = await linking.getState(req.params.name);
    return res.json({ success: true, data });
  } catch (error) {
    return replyLinkingError(res, error, 'la consulta de estado');
  }
});

module.exports = router;
