const axios = require('axios');
const logger = require('./logger');

// WhatsApp Cloud API (Meta) — provider principal del canal (decisión 2026-09-14).
// Un solo número/WABA por ahora: las credenciales son globales y cada
// WhatsAppInstance con provider 'meta' guarda su phoneNumberId. Igual que
// config/evolution.js, no lanza si faltan: el canal queda inactivo.
//
// Secrets (env-8tdon8):
//   WHATSAPP_META_ACCESS_TOKEN         token de system user (permanente) o temporal del panel
//   WHATSAPP_META_APP_SECRET           para verificar la firma X-Hub-Signature-256 del webhook
//   WHATSAPP_META_WEBHOOK_VERIFY_TOKEN string propio para el GET de verificación del webhook
// Opcionales:
//   WHATSAPP_META_GRAPH_VERSION        default v22.0
//   WHATSAPP_META_TEMPLATE_DIGEST      nombre de la plantilla utility aprobada (default novedades_carpetas)
//   WHATSAPP_META_TEMPLATE_LANG        default es_AR

const GRAPH_VERSION = process.env.WHATSAPP_META_GRAPH_VERSION || 'v22.0';

if (!process.env.WHATSAPP_META_ACCESS_TOKEN) {
  logger.warn('WhatsApp Cloud API (Meta) no configurada (WHATSAPP_META_ACCESS_TOKEN ausente) — el provider meta queda inactivo hasta que se configure.');
}

const client = axios.create({
  baseURL: `https://graph.facebook.com/${GRAPH_VERSION}`,
  headers: { Authorization: `Bearer ${process.env.WHATSAPP_META_ACCESS_TOKEN || ''}` },
  timeout: 20000,
});

const isConfigured = () => Boolean(process.env.WHATSAPP_META_ACCESS_TOKEN);

const templateDigest = () => process.env.WHATSAPP_META_TEMPLATE_DIGEST || 'novedades_carpetas';
const templateLang = () => process.env.WHATSAPP_META_TEMPLATE_LANG || 'es_AR';

module.exports = { client, isConfigured, templateDigest, templateLang, GRAPH_VERSION };
