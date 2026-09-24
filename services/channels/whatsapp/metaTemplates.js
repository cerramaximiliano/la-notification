/**
 * Plantillas de Meta: qué plantilla usa el aviso y qué hay disponible en la WABA.
 *
 * Los nombres dejaron de ser secreto: se administran desde la admin
 * (`judicial-notification-configs.whatsappTemplates`, cache de 60 s del
 * policyService) y las variables de entorno quedan como respaldo para no
 * romper nada si el config está vacío.
 *
 *   digest        plantilla única, 2 variables (count, folders)
 *   digestFamily  prefijo de la familia por líneas (`<familia>_1|2|3`); '' = no usar
 *   lang          código de idioma de las plantillas
 */

const { client, isConfigured } = require('../../../config/meta');
const logger = require('../../../config/logger');
const { WhatsAppInstance } = require('../../../models');

const DEFAULT_DIGEST = 'movimientos_carpetas';
const DEFAULT_LANG = 'es_AR';

/**
 * Nombres efectivos: config de la admin → env → default.
 * `digestFamily: ''` en el config significa "ninguna" y gana sobre el env.
 */
function resolveNames(config) {
  const t = config?.whatsappTemplates || {};
  const family = t.digestFamily ?? process.env.WHATSAPP_META_TEMPLATE_DIGEST_FAMILY ?? '';
  return {
    digest: t.digest || process.env.WHATSAPP_META_TEMPLATE_DIGEST || DEFAULT_DIGEST,
    family: String(family).trim() || null,
    lang: t.lang || process.env.WHATSAPP_META_TEMPLATE_LANG || DEFAULT_LANG,
  };
}

/** WABA desde la línea Meta registrada, o del env como respaldo. */
async function resolveWabaId() {
  const instance = await WhatsAppInstance.findOne({ provider: 'meta', wabaId: { $nin: [null, ''] } }).select('wabaId').lean();
  return instance?.wabaId || process.env.WHATSAPP_META_WABA_ID || null;
}

/**
 * Plantillas de la WABA con su estado. `status: 'PENDING'` = en revisión (no se
 * puede usar todavía); `previousCategory` presente = Meta le cambió la
 * categoría (típicamente UTILITY → MARKETING, o la vuelta tras una apelación).
 *
 * @returns {Promise<{ templates: Array, wabaId: string|null, error: string|null }>}
 */
async function listTemplates() {
  if (!isConfigured()) return { templates: [], wabaId: null, error: 'WhatsApp Cloud API no configurada' };
  const wabaId = await resolveWabaId();
  if (!wabaId) return { templates: [], wabaId: null, error: 'No hay ninguna línea Meta con wabaId registrado' };
  try {
    const res = await client.get(`/${wabaId}/message_templates`, {
      params: { fields: 'name,status,category,previous_category,language,rejected_reason', limit: 100 },
      timeout: 15000,
    });
    const templates = (res.data?.data || []).map(t => ({
      name: t.name,
      status: t.status,
      category: t.category,
      previousCategory: t.previous_category || null,
      language: t.language,
      rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
    }));
    return { templates, wabaId, error: null };
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message;
    logger.warn(`[WhatsApp] No se pudieron listar las plantillas de la WABA ${wabaId}: ${message}`);
    return { templates: [], wabaId, error: message };
  }
}

module.exports = { resolveNames, listTemplates, resolveWabaId, DEFAULT_DIGEST, DEFAULT_LANG };
