const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const provider = require('../services/channels/whatsapp/providers/evolutionApi.provider');
const whatsappWebhookController = require('../controllers/whatsappWebhookController');

/**
 * POST /api/whatsapp/webhook — lo llama Evolution API (no el frontend ni el hub).
 *
 * Auth: apikey (header `apikey` o campo `apikey` del body, que Evolution incluye
 * en cada payload) comparada contra EVOLUTION_WEBHOOK_APIKEY — fail-closed.
 * Configurar en Evolution: webhook URL https://<host de la-notification>/api/whatsapp/webhook,
 * eventos MESSAGES_UPSERT, MESSAGES_UPDATE y CONNECTION_UPDATE, sin base64 de media.
 */
router.post(
  '/',
  express.json({ limit: '2mb' }),
  (req, res, next) => {
    if (!provider.verifyWebhook(req)) {
      logger.warn('Webhook WhatsApp rechazado: apikey inválida o ausente');
      return res.status(401).json({ success: false, message: 'No autorizado' });
    }
    return next();
  },
  whatsappWebhookController.handleWebhook
);

module.exports = router;
