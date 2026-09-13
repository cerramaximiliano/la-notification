const crypto = require('crypto');
const logger = require('../../../config/logger');
const { WhatsAppOutbox, NotificationLog } = require('../../../models');
const { isConfigured } = require('../../../config/evolution');
const policyService = require('../../notificationPolicyService');
const provider = require('./providers/evolutionApi.provider');
const instances = require('./instances');
const { countSentToday } = require('./outbox');
const { buildOtpText } = require('./templates');

// Envío SÍNCRONO del código de verificación del teléfono, fuera del outbox:
// el usuario está esperando el código en pantalla, no tiene sentido encolarlo.
// El hub (law-analytics-server) genera y guarda el código; acá solo se manda.
//
// Es, por definición, el WhatsApp más "frío" del sistema (todavía no hay
// opt-in — es lo que se está verificando): solo sale a pedido explícito del
// usuario, con rate limit del lado del hub, y cuenta para el dailyLimit de la
// línea igual que cualquier otro envío.

class OtpUnavailableError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'OtpUnavailableError';
    this.reason = reason;
    this.unavailable = true;
  }
}

const REASON_MESSAGES = {
  channel_disabled: 'El canal de WhatsApp está deshabilitado (status.whatsappEnabled)',
  not_configured: 'Evolution API no configurada (EVOLUTION_API_URL/EVOLUTION_API_KEY)',
  no_instance: 'No hay ninguna instancia de WhatsApp activa (whatsapp-instances)',
  daily_limit: 'La línea asignada alcanzó su tope diario de mensajes',
};

/**
 * ¿Se puede mandar un OTP ahora? Sirve para que el hub/front sepan si mostrar
 * la verificación por WhatsApp antes de que el usuario cargue el número.
 * @returns {Promise<{ available: boolean, reason?: string, instance?: Object }>}
 */
async function checkAvailability(userId) {
  if (!policyService.isWhatsappEnabled(await policyService.getConfigCached())) {
    return { available: false, reason: 'channel_disabled' };
  }
  if (!isConfigured()) {
    return { available: false, reason: 'not_configured' };
  }
  const instance = userId
    ? await instances.resolveForUser(userId)
    : (await instances.getActiveInstances())[0] || null;
  if (!instance) {
    return { available: false, reason: 'no_instance' };
  }
  const limit = Number(instance.dailyLimit) || 0;
  if (limit > 0 && (await countSentToday(instance.name)) >= limit) {
    return { available: false, reason: 'daily_limit' };
  }
  return { available: true, instance };
}

/**
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.to   Teléfono E.164 a verificar
 * @param {string} params.code Código generado por el hub (no se persiste acá)
 * @throws {OtpUnavailableError} si el canal no puede enviar ahora (reason explica por qué)
 * @throws {Error} error del provider (número sin WhatsApp, Evolution caída, etc.)
 */
async function sendOtp({ userId, to, code }) {
  const availability = await checkAvailability(userId);
  if (!availability.available) {
    throw new OtpUnavailableError(availability.reason, REASON_MESSAGES[availability.reason]);
  }
  const { instance } = availability;

  const result = await provider.sendMessage(instance.name, to, buildOtpText(code));

  // Registro: en el outbox ya como 'sent' (cuenta para dailyLimit y correlaciona
  // el webhook por providerMessageId) + NotificationLog. Nunca se guarda el código.
  let outboxDoc = null;
  try {
    outboxDoc = await WhatsAppOutbox.create({
      userId,
      idempotencyKey: `otp:${crypto.randomUUID()}`,
      to,
      text: buildOtpText('••••••'),
      messageType: 'otp',
      entityType: 'otp',
      instanceName: instance.name,
      status: 'sent',
      providerMessageId: result.providerMessageId || null,
      attempts: 1,
      sentAt: new Date(),
    });
    await NotificationLog.createFromEntity('custom', { _id: userId }, {
      method: 'whatsapp',
      status: 'sent',
      content: { message: 'Código de verificación de teléfono', template: 'whatsapp_phone_otp' },
      delivery: {
        recipientPhone: to,
        providerMessageId: result.providerMessageId || null,
        outboxId: outboxDoc._id,
        attempts: 1,
      },
      metadata: { source: 'api' },
    }, userId);
  } catch (logError) {
    logger.warn(`OTP enviado pero no se pudo registrar (userId=${userId}): ${logError.message}`);
  }

  return { providerMessageId: result.providerMessageId || null, instanceName: instance.name };
}

module.exports = { sendOtp, checkAvailability, OtpUnavailableError };
