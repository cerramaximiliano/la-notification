/**
 * Bot conversacional de WhatsApp — v1 (sin IA).
 *
 * Responde a los mensajes de texto de usuarios verificados (la baja y la
 * verificación las resuelve antes el controller). Solo habla dentro de la
 * ventana de 24 h que abre el propio mensaje del usuario, así que las
 * respuestas son texto libre y gratis en Meta.
 *
 *   "novedades" / "movimientos" / "1"  → carpetas con movimientos detectados
 *                                        en las últimas 24 h (mismo formato
 *                                        que el aviso proactivo)
 *   "ayuda" / "menu" / cualquier otra → menú corto (como mucho FALLBACK_MAX
 *                                        veces por día por usuario)
 *
 * v2 (planificado): intents con Claude + tools de la-mcp-server (buscar
 * carpetas, movimientos, jurisprudencia) y recepción de documentos.
 */

const logger = require('../../../config/logger');
const { JudicialMovement, Folder } = require('../../../models');
const { buildMovementDigestText } = require('./templates');

const NOVEDADES_WINDOW_HOURS = 24;
const FALLBACK_MAX_PER_DAY = 3;
const FRONT_BASE_URL = (process.env.FRONTEND_URL || 'https://www.lawanalytics.app').replace(/\/$/, '');

const INTENT_NOVEDADES = new Set(['NOVEDADES', 'NOVEDAD', 'MOVIMIENTOS', 'MOVIMIENTO', 'NOVEDADES DE HOY', 'MOVIMIENTOS DE HOY', '1']);
const INTENT_MENU = new Set(['AYUDA', 'MENU', 'HOLA', 'BUENAS', 'BUEN DIA', 'BUENOS DIAS', 'BUENAS TARDES', 'INFO', '?', '0']);

function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function detectIntent(text) {
  const norm = normalize(text);
  if (INTENT_NOVEDADES.has(norm)) return 'novedades';
  if (INTENT_MENU.has(norm)) return 'menu';
  // "novedades?" / "hay movimientos?" / "que novedades hay"
  if (/\b(NOVEDAD|NOVEDADES|MOVIMIENTO|MOVIMIENTOS)\b/.test(norm) && norm.split(' ').length <= 6) return 'novedades';
  return 'fallback';
}

/**
 * Movimientos del usuario detectados en las últimas 24 h, agrupados por
 * expediente como en el dispatcher, con el nombre de carpeta del usuario.
 */
async function recentMovementsDigest(userId) {
  const since = new Date(Date.now() - NOVEDADES_WINDOW_HOURS * 60 * 60 * 1000);
  const movements = await JudicialMovement.find({
    userId,
    createdAt: { $gte: since },
    notificationStatus: { $ne: 'skipped' },
  }).select('expediente movimiento').lean();

  if (movements.length === 0) return null;

  const movementsByExpediente = {};
  for (const m of movements) {
    const key = m.expediente?.id || `${m.expediente?.number}/${m.expediente?.year ?? ''}`;
    if (!movementsByExpediente[key]) movementsByExpediente[key] = { expediente: m.expediente, movements: [] };
    movementsByExpediente[key].movements.push(m);
  }

  const causaIds = Object.values(movementsByExpediente).map(v => v.expediente?.id).filter(Boolean);
  const folders = causaIds.length
    ? await Folder.find({ userId, causaId: { $in: causaIds } }).select('causaId folderName').lean()
    : [];
  const folderNameByExpediente = {};
  for (const f of folders) if (f.causaId && f.folderName) folderNameByExpediente[f.causaId] = f.folderName;

  return buildMovementDigestText(movementsByExpediente, { folderNameByExpediente });
}

function menuText(name) {
  const saludo = name ? `Hola ${name}.` : 'Hola.';
  return [
    `${saludo} Soy el asistente de Law||Analytics. Por ahora entiendo esto:`,
    '',
    '*novedades* → carpetas con movimientos nuevos en las últimas 24 h',
    '*BAJA* → dejar de recibir avisos por WhatsApp',
    '',
    `Todo lo demás, en la app: ${FRONT_BASE_URL}/apps/folders/list?source=whatsapp_bot`,
  ].join('\n');
}

function noNewsText() {
  return [
    `No hay movimientos nuevos en tus carpetas en las últimas ${NOVEDADES_WINDOW_HOURS} horas.`,
    `Ver tus carpetas: ${FRONT_BASE_URL}/apps/folders/list?source=whatsapp_bot`,
  ].join('\n');
}

/**
 * Decide la respuesta para un texto de un usuario verificado con acceso.
 * @returns {Promise<{ handledAs: string, text: string|null, countsAsFallback: boolean }>}
 */
async function respond({ user, text }) {
  const intent = detectIntent(text);
  const firstName = user?.name?.split(' ')[0];

  if (intent === 'novedades') {
    let digest = null;
    try {
      digest = await recentMovementsDigest(user._id);
    } catch (error) {
      logger.warn(`[WhatsApp bot] No se pudieron leer los movimientos de ${user._id}: ${error.message}`);
      return { handledAs: 'bot_error', text: 'No pude consultar tus carpetas en este momento. Probá de nuevo en unos minutos.', countsAsFallback: false };
    }
    return { handledAs: 'bot_novedades', text: digest || noNewsText(), countsAsFallback: false };
  }

  return { handledAs: intent === 'menu' ? 'bot_menu' : 'bot_fallback', text: menuText(firstName), countsAsFallback: true };
}

module.exports = { respond, detectIntent, recentMovementsDigest, FALLBACK_MAX_PER_DAY, _internal: { normalize, menuText, noNewsText } };
