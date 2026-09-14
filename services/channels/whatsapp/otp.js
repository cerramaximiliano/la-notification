const crypto = require('crypto');
const logger = require('../../../config/logger');
const { WhatsAppOutbox, NotificationLog } = require('../../../models');
const { isConfigured: evolutionConfigured } = require('../../../config/evolution');
const { isConfigured: metaConfigured } = require('../../../config/meta');
const policyService = require('../../notificationPolicyService');
const { sendViaInstance } = require('./providers');
const instances = require('./instances');
const { countSentToday } = require('./outbox');
const { buildOtpText } = require('./templates');

/**
 * Verificación del teléfono del usuario — dos modos:
 *
 *  - "inbound" (default, todos los providers): el usuario nos escribe desde su
 *    número un texto prellenado con el código (link wa.me). No mandamos nada
 *    frío, no cuesta, abre la ventana de 24 h y el envío mismo es su
 *    consentimiento. Lo procesa el webhook (controllers/whatsappWebhookController).
 *  - "outbound" (WHATSAPP_VERIFY_MODE=outbound, solo Baileys): mandamos el
 *    código por WhatsApp, síncrono y fuera del outbox. Con Meta no aplica
 *    (requeriría plantilla de autenticación paga).
 *
 * El hub genera y guarda el código; acá solo se decide el modo y, si es
 * outbound, se envía.
 */

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
  not_configured: 'El provider de WhatsApp no está configurado',
  no_instance: 'No hay ninguna instancia de WhatsApp activa (whatsapp-instances)',
  no_number: 'La instancia activa no tiene número (phoneNumber) para el link de verificación',
  daily_limit: 'La línea asignada alcanzó su tope diario de mensajes',
  inbound_only: 'Con este provider la verificación es por mensaje entrante, no por código enviado',
};

function providerConfigured(instance) {
  return instance?.provider === 'meta' ? metaConfigured() : evolutionConfigured();
}

function verifyMode(instance) {
  if (instance?.provider === 'meta') return 'inbound';
  return process.env.WHATSAPP_VERIFY_MODE === 'outbound' ? 'outbound' : 'inbound';
}

/**
 * ¿Se puede verificar un número ahora, y cómo?
 * @returns {Promise<{ available: boolean, reason?: string, mode?: 'inbound'|'outbound', number?: string, instance?: Object }>}
 *   `number` = E.164 de la línea (para el link wa.me en modo inbound).
 */
async function checkAvailability(userId) {
  if (!policyService.isWhatsappEnabled(await policyService.getConfigCached())) {
    return { available: false, reason: 'channel_disabled' };
  }
  const instance = userId
    ? await instances.resolveForUser(userId)
    : (await instances.getActiveInstances())[0] || null;
  if (!instance) {
    return { available: false, reason: 'no_instance' };
  }
  if (!providerConfigured(instance)) {
    return { available: false, reason: 'not_configured' };
  }
  const mode = verifyMode(instance);
  if (mode === 'inbound' && !instance.phoneNumber) {
    return { available: false, reason: 'no_number', mode };
  }
  const limit = Number(instance.dailyLimit) || 0;
  if (mode === 'outbound' && limit > 0 && (await countSentToday(instance.name)) >= limit) {
    return { available: false, reason: 'daily_limit', mode };
  }
  return { available: true, mode, number: instance.phoneNumber || null, instance };
}

/**
 * Modo outbound: envía el código. Registra el envío en el outbox como 'sent'
 * (cuenta para dailyLimit, correlaciona el webhook) + NotificationLog. Nunca
 * persiste el código.
 * @throws {OtpUnavailableError} si el canal no puede enviar ahora
 * @throws {Error} error del provider
 */
async function sendOtp({ userId, to, code }) {
  const availability = await checkAvailability(userId);
  if (!availability.available) {
    throw new OtpUnavailableError(availability.reason, REASON_MESSAGES[availability.reason]);
  }
  if (availability.mode !== 'outbound') {
    throw new OtpUnavailableError('inbound_only', REASON_MESSAGES.inbound_only);
  }
  const { instance } = availability;

  const result = await sendViaInstance(instance, to, buildOtpText(code));

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
      provider: instance.provider || 'baileys',
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
