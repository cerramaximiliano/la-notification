const { expedienteLabel } = require('../../templateProcessor');

const DEFAULT_FRONT_BASE_URL = process.env.FRONT_BASE_URL || 'https://www.lawanalytics.app';
// Tope de carpetas listadas: el mensaje tiene que seguir siendo breve aunque
// un estudio grande tenga 40 carpetas con novedades el mismo día.
const MAX_LISTED = 10;

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Mensaje breve de WhatsApp para el digest de movimientos judiciales: solo
 * lista las carpetas con novedades (sin el detalle de cada movimiento — eso
 * lo tiene el email). Un mensaje por corrida del digest, nunca uno por
 * movimiento — ver el análisis de riesgo de baneo del informe de WhatsApp.
 *
 * @param {Object} movementsByExpediente Misma forma que arma services/notifications.js:
 *   { [key]: { expediente: {id, number, year, label, fuero, caratula, objeto}, movements: [...] } }
 * @param {Object} [options]
 * @param {Object.<string,string>} [options.folderNameByExpediente] key → folderName de la carpeta
 *   del usuario (si se resolvió); si falta, cae a expedienteLabel(expediente).
 * @param {string} [options.frontBaseUrl]
 * @returns {string|null} null si no hay nada que avisar
 */
function buildMovementDigestText(movementsByExpediente, options = {}) {
  const { folderNameByExpediente = {}, frontBaseUrl = DEFAULT_FRONT_BASE_URL } = options;

  const entries = Object.entries(movementsByExpediente || {})
    .filter(([, data]) => (data?.movements?.length || 0) > 0);
  const total = entries.length;

  if (total === 0) return null;

  const carpetaWord = total === 1 ? 'carpeta' : 'carpetas';
  const lines = [`Tenés novedades en ${total} ${carpetaWord}:`, ''];

  for (const [key, data] of entries.slice(0, MAX_LISTED)) {
    const nombre = cleanName(folderNameByExpediente[key]) || cleanName(expedienteLabel(data.expediente));
    const cantidad = data.movements.length;
    const novedadWord = cantidad === 1 ? 'novedad' : 'novedades';
    lines.push(`• ${nombre} — ${cantidad} ${novedadWord}`);
  }

  if (total > MAX_LISTED) {
    const resto = total - MAX_LISTED;
    lines.push(`…y ${resto} ${resto === 1 ? 'carpeta más' : 'carpetas más'}`);
  }

  lines.push('', `Ver el detalle: ${frontBaseUrl}/apps/folders/list?source=whatsapp_movimiento`);

  return lines.join('\n');
}

module.exports = { buildMovementDigestText };
