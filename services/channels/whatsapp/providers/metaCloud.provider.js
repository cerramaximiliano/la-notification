const crypto = require('crypto');
const { client, isConfigured, templateDigest, templateLang } = require('../../../../config/meta');
const logger = require('../../../../config/logger');
const { WhatsAppContact } = require('../../../../models');

/**
 * WhatsApp Cloud API (Meta) — provider principal.
 *
 * Reglas de Meta que condicionan este módulo:
 *  - Fuera de la ventana de servicio (24 h desde el último mensaje del usuario)
 *    solo se puede enviar una PLANTILLA aprobada (paga, categoría utility).
 *    Dentro de la ventana, texto libre y gratis.
 *  - Los parámetros de plantilla no admiten saltos de línea ni tabs.
 *  - El webhook llega firmado (X-Hub-Signature-256 = HMAC-SHA256 del body crudo
 *    con el app secret) y se da de alta con un GET de verificación (hub.challenge).
 */

class MetaSendError extends Error {
  constructor(message, { permanent = false, status = null, details = null } = {}) {
    super(message);
    this.name = 'MetaSendError';
    this.permanent = permanent;
    this.status = status;
    this.details = details;
  }
}

const toWaId = (e164) => String(e164 || '').replace(/[^\d]/g, '');
const toE164 = (waId) => (waId ? `+${String(waId).replace(/[^\d]/g, '')}` : null);

function requireConfigured(instance) {
  if (!isConfigured()) {
    throw new MetaSendError('WhatsApp Cloud API no configurada (WHATSAPP_META_ACCESS_TOKEN)');
  }
  if (!instance?.phoneNumberId) {
    throw new MetaSendError(`La instancia '${instance?.name}' no tiene phoneNumberId`, { permanent: true });
  }
}

// Código de Graph "Recipient phone number not in allowed list": solo lo devuelve
// el NÚMERO DE PRUEBA de Meta (lista de hasta 5 destinatarios). Esa lista guarda
// los celulares argentinos en la forma vieja `54 <área> 15 <número>` y rechaza
// el `549…` canónico (verificado 2026-09-14). Con un número real no ocurre.
const NOT_IN_ALLOWED_LIST = 131030;

// Variantes `54<área>15<número>` de un `549<área><número>` (área de 2, 3 o 4
// dígitos: no se puede saber cuál sin tabla, así que se prueban las tres).
function argentinaLegacyVariants(waId) {
  const m = /^549(\d{10})$/.exec(waId);
  if (!m) return [];
  const rest = m[1];
  return [2, 3, 4].map((len) => `54${rest.slice(0, len)}15${rest.slice(len)}`);
}

async function postOnce(instance, payload) {
  try {
    const res = await client.post(`/${instance.phoneNumberId}/messages`, { messaging_product: 'whatsapp', ...payload });
    return res.data?.messages?.[0]?.id || null;
  } catch (error) {
    const status = error.response?.status || null;
    const details = error.response?.data?.error || null;
    // 4xx de Graph = problema del payload/destinatario/token: reintentar no ayuda
    // (salvo 429 y 5xx). Código 131047 = ventana cerrada sin plantilla.
    const permanent = Number.isInteger(status) && status >= 400 && status < 500 && status !== 429;
    throw new MetaSendError(
      `Meta rechazó el envío${status ? ` (${status})` : ''}: ${details?.message || error.message}`,
      { permanent, status, details }
    );
  }
}

async function post(instance, payload) {
  try {
    return await postOnce(instance, payload);
  } catch (error) {
    if (error.details?.code !== NOT_IN_ALLOWED_LIST) throw error;
    const variants = argentinaLegacyVariants(payload.to);
    if (variants.length === 0) throw error;
    logger.warn(`Meta (número de prueba) no admite ${payload.to}; se prueba la forma 54…15… de la lista de destinatarios`);
    let lastError = error;
    for (const to of variants) {
      try {
        return await postOnce(instance, { ...payload, to });
      } catch (retryError) {
        lastError = retryError;
        if (retryError.details?.code !== NOT_IN_ALLOWED_LIST) throw retryError;
      }
    }
    throw lastError;
  }
}

/**
 * Envía a `to`. Con la ventana de 24 h abierta manda texto libre; si está
 * cerrada, la plantilla del digest con `templateParams` ({ count, folders,
 * ctaSuffix }); sin plantilla posible → error permanente.
 */
async function sendMessage(instance, to, text, { templateParams = null, forceTemplate = false } = {}) {
  requireConfigured(instance);
  const contact = await WhatsAppContact.findOne({ phone: to }).lean();
  const windowOpen = WhatsAppContact.isServiceWindowOpen(contact);

  let providerMessageId;
  let kind;
  if (windowOpen && !forceTemplate) {
    providerMessageId = await post(instance, { to: toWaId(to), type: 'text', text: { body: text, preview_url: false } });
    kind = 'text';
  } else if (templateParams) {
    const components = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: String(templateParams.count) },
          { type: 'text', text: String(templateParams.folders) },
        ],
      },
    ];
    if (templateParams.ctaSuffix) {
      components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(templateParams.ctaSuffix) }] });
    }
    providerMessageId = await post(instance, {
      to: toWaId(to),
      type: 'template',
      template: { name: templateDigest(), language: { code: templateLang() }, components },
    });
    kind = 'template';
  } else {
    throw new MetaSendError('Ventana de 24 h cerrada y el mensaje no tiene versión de plantilla', { permanent: true });
  }

  await WhatsAppContact.updateOne(
    { phone: to },
    { $set: { lastOutboundAt: new Date(), lastInstanceName: instance.name } },
    { upsert: true }
  );
  logger.info(`WhatsApp (meta/${kind}) enviado a ${to} desde '${instance.name}' (id ${providerMessageId || 'sin-id'})`);
  return { providerMessageId, status: 'sent', kind };
}

/**
 * Normaliza el webhook de Meta a los mismos eventos que el provider Baileys:
 * type 'message' (inbound) | 'status'. Devuelve `phoneNumberId` en cada
 * evento; el controller lo resuelve a la instancia registrada.
 */
function parseWebhook(body = {}) {
  const events = [];
  if (body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return events;

  for (const entry of body.entry) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || null;
      const names = {};
      for (const c of value.contacts || []) if (c.wa_id) names[c.wa_id] = c.profile?.name || null;

      for (const m of value.messages || []) {
        const text = m.type === 'text' ? m.text?.body
          : m.type === 'button' ? m.button?.text
          : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title)
          : (m[m.type]?.caption ?? null);
        const media = ['image', 'document', 'audio', 'video', 'sticker'].includes(m.type)
          ? { kind: m.type, id: m[m.type]?.id, mimeType: m[m.type]?.mime_type, filename: m[m.type]?.filename || null }
          : null;
        events.push({
          providerMessageId: m.id || null,
          status: 'received',
          type: 'message',
          from: m.from || null,
          fromPhone: toE164(m.from),
          profileName: names[m.from] || null,
          phoneNumberId,
          instance: null,
          text: text ?? null,
          media,
          timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        });
      }

      for (const s of value.statuses || []) {
        const map = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', deleted: 'failed' };
        events.push({
          providerMessageId: s.id || null,
          status: map[s.status] || 'sent',
          type: 'status',
          from: s.recipient_id || null,
          fromPhone: toE164(s.recipient_id),
          phoneNumberId,
          instance: null,
          text: s.errors?.[0]?.title || null,
          pricing: s.pricing || null,
        });
      }
    }
  }
  return events;
}

// GET de verificación del webhook (alta en el panel de Meta).
function verifyChallenge(query = {}) {
  const expected = process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return null;
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === expected) {
    return query['hub.challenge'] || '';
  }
  return null;
}

// Firma del POST: sha256=HMAC(app secret, body crudo). Necesita req.rawBody
// (app.js lo guarda en el parser JSON global). Fail-closed.
function verifyWebhook(req) {
  const secret = process.env.WHATSAPP_META_APP_SECRET;
  if (!secret) {
    logger.error('WHATSAPP_META_APP_SECRET no configurado — webhook de Meta rechazado');
    return false;
  }
  const header = req.headers?.['x-hub-signature-256'];
  if (typeof header !== 'string' || !header.startsWith('sha256=') || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const provided = header.slice(7);
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Datos del número (para registrar/validar una instancia meta y ver su calidad).
async function getPhoneNumberInfo(phoneNumberId) {
  if (!isConfigured()) throw new MetaSendError('WhatsApp Cloud API no configurada (WHATSAPP_META_ACCESS_TOKEN)');
  try {
    const res = await client.get(`/${phoneNumberId}`, { params: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status' } });
    return res.data;
  } catch (error) {
    const details = error.response?.data?.error;
    throw new MetaSendError(`Meta no reconoce el número (${error.response?.status || 'red'}): ${details?.message || error.message}`, { permanent: true, details });
  }
}

// Media entrante (bot v2): la URL vence a los 5 minutos; descargar enseguida.
async function downloadMedia(mediaId) {
  if (!isConfigured()) throw new MetaSendError('WhatsApp Cloud API no configurada');
  const meta = (await client.get(`/${mediaId}`)).data;
  const file = await client.get(meta.url, { responseType: 'arraybuffer', baseURL: '' });
  return { buffer: Buffer.from(file.data), mimeType: meta.mime_type, size: meta.file_size, sha256: meta.sha256 };
}

module.exports = { sendMessage, parseWebhook, verifyChallenge, verifyWebhook, getPhoneNumberInfo, downloadMedia, MetaSendError, toE164, toWaId };
