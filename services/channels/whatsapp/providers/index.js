const evolution = require('./evolutionApi.provider');
const meta = require('./metaCloud.provider');
const { WhatsAppContact } = require('../../../../models');

/**
 * Despachador por provider. Todo envío del canal pasa por acá con la
 * instancia resuelta (models/WhatsAppInstance.js), nunca por un provider
 * directo — así el outbox, el OTP y las respuestas del webhook no saben si
 * la línea es Meta o Baileys.
 */
function getProvider(instance) {
  return instance?.provider === 'meta' ? meta : evolution;
}

/**
 * @param {Object} instance  doc/lean de WhatsAppInstance
 * @param {string} to        E.164
 * @param {string} text      texto libre
 * @param {Object} [opts]    { templateParams, forceTemplate } (solo los usa Meta)
 * @returns {Promise<{ providerMessageId: string|null, status: string, kind?: string }>}
 */
async function sendViaInstance(instance, to, text, opts = {}) {
  if (instance?.provider === 'meta') {
    return meta.sendMessage(instance, to, text, opts);
  }
  const result = await evolution.sendMessage(instance.name, to, text);
  await WhatsAppContact.updateOne(
    { phone: to },
    { $set: { lastOutboundAt: new Date(), lastInstanceName: instance.name } },
    { upsert: true }
  ).catch(() => {});
  return result;
}

// Error que no vale la pena reintentar (número inválido, plantilla ausente,
// token vencido...). Lo consulta outbox.markFailedAttempt.
function isPermanentSendError(error) {
  if (error?.permanent === true) return true;
  const status = error?.response?.status ?? error?.status;
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 429;
}

module.exports = { getProvider, sendViaInstance, isPermanentSendError, evolution, meta };
