const axios = require('axios');
const logger = require('./logger');

// A diferencia de config/aws.js, acá NO se lanza al faltar credenciales: el
// canal de WhatsApp es opt-in y puede no estar configurado todavía (no hay
// línea/instancia Evolution API vinculada aún). El cliente se arma igual;
// cualquier llamada real sin EVOLUTION_API_URL/EVOLUTION_API_KEY falla recién
// al invocarse, y el caller (outbox.js) la registra como envío fallido.
//
// Esto es solo la conexión al DEPLOYMENT de Evolution API (una instancia de
// Evolution puede alojar varias líneas/números). Qué línea usar para cada
// envío es un dato, no una env var — ver models/WhatsAppInstance.js y
// services/channels/whatsapp/instances.js.
if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
  logger.warn('Evolution API no configurada (EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes) — el canal de WhatsApp queda inactivo hasta que se configure.');
}

const client = axios.create({
  baseURL: process.env.EVOLUTION_API_URL,
  headers: { apikey: process.env.EVOLUTION_API_KEY },
  timeout: 15000,
});

const isConfigured = () => Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY);

module.exports = { client, isConfigured };
