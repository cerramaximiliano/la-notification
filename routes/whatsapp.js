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
 * Auth: Bearer INTERNAL_SERVICE_TOKEN (fail-closed). Los webhooks de los
 * providers NO van acá (routes/whatsappWebhook.js y routes/whatsappMetaWebhook.js).
 */

/**
 * GET /api/whatsapp/availability?user_id=...
 * → { success, available, reason, mode, number }
 *   mode: 'inbound' (el usuario nos escribe con el código — default) | 'outbound' (le mandamos el código)
 *   number: E.164 de la línea asignada (para el link wa.me en modo inbound)
 */
router.get('/availability', verifyServiceToken, async (req, res) => {
  try {
    const { available, reason, mode, number } = await otp.checkAvailability(req.query.user_id || null);
    return res.json({ success: true, available, reason: reason || null, mode: mode || null, number: number || null });
  } catch (error) {
    logger.error(`[whatsapp] availability: ${error.message}`);
    return res.status(500).json({ success: false, available: false, reason: 'error' });
  }
});

/**
 * POST /api/whatsapp/send-otp  (solo modo outbound)
 * Body: { user_id, phone (E.164), code }
 * 200 { success:true, provider_message_id } · 503 { reason } · 502 provider_error
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
    logger.error(`[whatsapp] send-otp falló para userId=${userId}: ${error.message}`);
    return res.status(502).json({ success: false, reason: 'provider_error', message: 'No se pudo enviar el código por WhatsApp' });
  }
});

/**
 * Líneas (lo consume la admin UI vía el hub — las credenciales no salen de acá).
 *
 * POST /api/whatsapp/instances   Body: { name, label?, phone?, provider?: 'meta'|'baileys', phoneNumberId?, wabaId? }
 *   201 { success, data: { name, provider, alreadyExisted, evolutionStatus, qr, meta? } }
 * GET  /api/whatsapp/instances/:name/qr?number=   (solo baileys) → { success, data: qr|null }
 * GET  /api/whatsapp/instances/:name/state         (solo baileys) → { success, data: { state } }
 */
router.post('/instances', verifyServiceToken, async (req, res) => {
  const { name, label, phone, provider, phoneNumberId, wabaId } = req.body || {};
  if (!name) {
    return res.status(400).json({ success: false, message: 'Se requiere name' });
  }
  try {
    const data = await linking.createInstance({
      name: String(name).trim(),
      label,
      phoneNumber: phone,
      provider: provider === 'meta' ? 'meta' : 'baileys',
      phoneNumberId,
      wabaId,
    });
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
