/**
 * Contrato que implementa cualquier provider de WhatsApp (ver docs/whatsapp/02-provider-adapter.md).
 *
 * A diferencia del diseño original pensado para Meta Cloud API/Twilio, este
 * contrato no tiene `sendTemplate` — Evolution API (Baileys) no exige
 * plantillas pre-aprobadas, así que el texto final se arma en templates.js
 * antes de encolar y el provider solo lo manda tal cual.
 */
module.exports = {
  /**
   * Envía un mensaje de texto libre desde una línea/instancia dada.
   * @param {string} instanceName Nombre de la instancia (models/WhatsAppInstance.js) — puede haber varias
   * @param {string} to           Teléfono E.164, ej "+5491155555555"
   * @param {string} text         Texto ya renderizado (sin HTML)
   * @returns {Promise<{ providerMessageId: string, status: string }>}
   */
  async sendMessage(instanceName, to, text) {
    throw new Error('sendMessage no implementado');
  },

  /**
   * Normaliza el payload del webhook inbound del provider a un formato común.
   * @param {object} body Body crudo del webhook
   * @returns {Array<{ providerMessageId: string, status: string, type: 'status'|'message', from: string, text: string }>}
   *   status: 'sent' | 'delivered' | 'read' | 'failed' (type 'status')
   *   type:   'message' = inbound del usuario (ej. confirmación de opt-in o "BAJA")
   */
  parseWebhook(body) {
    throw new Error('parseWebhook no implementado');
  },

  /**
   * Verifica que el webhook realmente venga del provider configurado.
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  verifyWebhook(req) {
    throw new Error('verifyWebhook no implementado');
  },
};
