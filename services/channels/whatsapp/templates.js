const { expedienteLabel } = require('../../templateProcessor');

const DEFAULT_FRONT_BASE_URL = process.env.FRONT_BASE_URL || 'https://www.lawanalytics.app';
// Tope de carpetas listadas: el mensaje tiene que seguir siendo breve aunque
// un estudio grande tenga 40 carpetas con novedades el mismo día.
const MAX_LISTED = 10;
const DIGEST_CTA_PATH = 'apps/folders/list?source=whatsapp_movimiento';

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function digestEntries(movementsByExpediente, folderNameByExpediente = {}) {
  return Object.entries(movementsByExpediente || {})
    .filter(([, data]) => (data?.movements?.length || 0) > 0)
    .map(([key, data]) => ({
      nombre: cleanName(folderNameByExpediente[key]) || cleanName(expedienteLabel(data.expediente)),
      cantidad: data.movements.length,
    }));
}

/**
 * Mensaje breve de WhatsApp para el digest de movimientos judiciales: solo
 * lista las carpetas con novedades (sin el detalle de cada movimiento — eso
 * lo tiene el email). Un mensaje por corrida del digest, nunca uno por
 * movimiento. Es la versión de TEXTO LIBRE (Baileys, o Meta con la ventana de
 * 24 h abierta); la versión plantilla es buildMovementDigestTemplateParams.
 *
 * @returns {string|null} null si no hay nada que avisar
 */
function buildMovementDigestText(movementsByExpediente, options = {}) {
  const { folderNameByExpediente = {}, frontBaseUrl = DEFAULT_FRONT_BASE_URL } = options;
  const entries = digestEntries(movementsByExpediente, folderNameByExpediente);
  const total = entries.length;
  if (total === 0) return null;

  const lines = [`Tenés novedades en ${total} ${total === 1 ? 'carpeta' : 'carpetas'}:`, ''];
  for (const { nombre, cantidad } of entries.slice(0, MAX_LISTED)) {
    lines.push(`• ${nombre} — ${cantidad} ${cantidad === 1 ? 'novedad' : 'novedades'}`);
  }
  if (total > MAX_LISTED) {
    const resto = total - MAX_LISTED;
    lines.push(`…y ${resto} ${resto === 1 ? 'carpeta más' : 'carpetas más'}`);
  }
  lines.push('', `Ver el detalle: ${frontBaseUrl}/${DIGEST_CTA_PATH}`);
  return lines.join('\n');
}

/**
 * Parámetros de la plantilla utility de Meta (`movimientos_carpetas`, WHATSAPP_META_TEMPLATE_DIGEST):
 *   body: "Tenés novedades en {{1}} carpeta(s): {{2}}"  + botón URL con sufijo dinámico.
 * Meta no admite saltos de línea ni tabs en los parámetros: todo en una línea.
 *
 * @returns {{ count: string, folders: string, ctaSuffix: string } | null}
 */
function buildMovementDigestTemplateParams(movementsByExpediente, options = {}) {
  const { folderNameByExpediente = {} } = options;
  const entries = digestEntries(movementsByExpediente, folderNameByExpediente);
  const total = entries.length;
  if (total === 0) return null;

  const items = entries.slice(0, MAX_LISTED).map(({ nombre, cantidad }) => `${nombre} (${cantidad})`);
  if (total > MAX_LISTED) items.push(`y ${total - MAX_LISTED} más`);
  return {
    count: String(total),
    folders: items.join(', ').replace(/[\n\r\t]+/g, ' ').replace(/ {4,}/g, '   '),
    ctaSuffix: DIGEST_CTA_PATH,
  };
}

/**
 * Código de verificación del teléfono enviado por nosotros (solo modo
 * "outbound", Baileys). Es el primer mensaje que recibe ese número — corto,
 * sin links, sin marketing.
 */
function buildOtpText(code) {
  return [
    `Tu código de verificación de Law||Analytics es *${code}*.`,
    '',
    'Vence en 10 minutos. Si no pediste este código, ignorá este mensaje.',
  ].join('\n');
}

// Verificación "inbound": el usuario nos manda este texto (prellenado por un
// link wa.me) desde su propio número. Enviarlo es su consentimiento explícito
// y abre la ventana de 24 h. El hub arma el mismo texto; lo que importa es
// que contenga VERIFICAR-<6 dígitos> (ver VERIFICATION_CODE_RE).
const VERIFICATION_CODE_RE = /VERIFICAR[\s:.-]*([0-9]{6})/i;

function buildInboundVerificationText(code) {
  return `Quiero recibir por WhatsApp los avisos de novedades de mis causas en Law||Analytics. Código: VERIFICAR-${code}`;
}

function buildVerifiedReplyText(name) {
  return [
    `${name ? `Listo, ${name}` : 'Listo'}: tu número quedó verificado y vas a recibir por acá los avisos de novedades de tus causas.`,
    'Guardá este contacto. Si querés dejar de recibirlos, respondé *BAJA*.',
  ].join('\n');
}

function buildVerificationFailedText() {
  return 'No pudimos verificar ese código: puede haber vencido o no coincidir con el número que cargaste. Volvé a Configuración → Canales → WhatsApp en Law||Analytics y pedí uno nuevo.';
}

/** Respuesta a una baja por chat (BAJA/STOP). */
function buildOptOutConfirmationText() {
  return 'Listo, no vas a recibir más avisos por WhatsApp. Podés volver a activarlos cuando quieras desde tu configuración en Law||Analytics.';
}

/**
 * Respuesta automática a cualquier otro mensaje de un usuario conocido: este
 * número no atiende consultas (todavía). Como mucho una vez por día por usuario.
 */
// Usuario verificado que perdió el acceso (prueba del plan gratuito vencida o
// sin plan pago). Se responde dentro de la ventana de 24 h (gratis en Meta).
function buildAccessExpiredText(name, { reason } = {}) {
  const saludo = name ? `Hola ${name}.` : 'Hola.';
  const motivo = reason === 'trial_expired'
    ? 'Tu período de prueba de WhatsApp en Law||Analytics terminó.'
    : 'Los avisos por WhatsApp de Law||Analytics están incluidos en los planes pagos.';
  return [
    `${saludo} ${motivo}`,
    '',
    'Para seguir recibiendo por acá las novedades de tus causas, pasá a un plan Estándar o superior:',
    `${DEFAULT_FRONT_BASE_URL}/apps/profiles/account/subscription?source=whatsapp_trial`,
    '',
    'Los avisos por email siguen llegando como siempre.',
  ].join('\n');
}

function buildAutoReplyText(name) {
  const saludo = name ? `Hola ${name}.` : 'Hola.';
  return [
    `${saludo} Este número solo envía los avisos automáticos de Law||Analytics y no recibe consultas.`,
    '',
    'Si no querés recibir más avisos por WhatsApp, respondé *BAJA*.',
    `Para gestionar tus notificaciones: ${DEFAULT_FRONT_BASE_URL}/apps/profiles/user/settings?source=whatsapp_autoreply`,
  ].join('\n');
}

module.exports = {
  buildMovementDigestText,
  buildMovementDigestTemplateParams,
  buildOtpText,
  buildInboundVerificationText,
  buildVerifiedReplyText,
  buildVerificationFailedText,
  buildOptOutConfirmationText,
  buildAutoReplyText,
  buildAccessExpiredText,
  VERIFICATION_CODE_RE,
};
