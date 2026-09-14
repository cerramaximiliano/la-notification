const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const meta = require('../services/channels/whatsapp/providers/metaCloud.provider');
const { processEvents } = require('../controllers/whatsappWebhookController');

/**
 * Webhook de WhatsApp Cloud API (Meta) — /api/whatsapp/meta-webhook
 *
 * GET : verificación al dar de alta el webhook en el panel de Meta
 *       (hub.mode=subscribe, hub.verify_token = WHATSAPP_META_WEBHOOK_VERIFY_TOKEN → hub.challenge).
 * POST: eventos firmados con X-Hub-Signature-256 (HMAC del body crudo con
 *       WHATSAPP_META_APP_SECRET; app.js guarda req.rawBody). Fail-closed.
 *       Se responde 200 enseguida y se procesa después: Meta reintenta si no
 *       recibe 200 rápido, y el procesamiento puede llamar al hub y responder.
 * Configurar en Meta: campo `messages` de la WABA suscripto al webhook.
 */
router.get('/', (req, res) => {
  const challenge = meta.verifyChallenge(req.query || {});
  if (challenge === null) {
    logger.warn('Webhook Meta: verificación rechazada (verify token inválido o no configurado)');
    return res.status(403).send('forbidden');
  }
  return res.status(200).send(challenge);
});

router.post('/', (req, res) => {
  if (!meta.verifyWebhook(req)) {
    logger.warn('Webhook Meta rechazado: firma inválida o ausente');
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }
  let events = [];
  try {
    events = meta.parseWebhook(req.body || {});
  } catch (error) {
    logger.error(`Webhook Meta: payload inválido: ${error.message}`);
  }
  res.status(200).json({ success: true, received: events.length });
  if (events.length > 0) {
    processEvents(events).catch(error => logger.error(`Webhook Meta: error procesando: ${error.message}`));
  }
});

module.exports = router;
