const { expedienteLabel } = require('../../templateProcessor');

const DEFAULT_FRONT_BASE_URL = process.env.FRONT_BASE_URL || 'https://www.lawanalytics.app';
// Tope de carpetas listadas: el mensaje tiene que seguir siendo breve aunque
// un estudio grande tenga 40 carpetas con novedades el mismo día.
const MAX_LISTED = 10;
const DIGEST_CTA_PATH = 'apps/folders/list?source=whatsapp_movimiento';
// Largo máximo del nombre de carpeta en las plantillas por línea (WhatsApp
// corta visualmente las líneas largas en el celular).
const LINE_NAME_MAX = 60;

function truncateName(value, max) {
  const v = cleanName(value);
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// Una entrada por carpeta con la cantidad de movimientos y de cédulas
// (notificaciones electrónicas). Las cédulas se dicen explícitamente como
// "cédula" para que el usuario sepa que no es un movimiento del expediente.
function digestEntries(movementsByExpediente, folderNameByExpediente = {}, cedulasByExpediente = {}) {
  const byKey = {};
  const nameFor = (key, expediente) => cleanName(folderNameByExpediente[key]) || cleanName(expediente?.caratula) || cleanName(expedienteLabel(expediente));
  for (const [key, data] of Object.entries(movementsByExpediente || {})) {
    const n = data?.movements?.length || 0;
    if (n === 0) continue;
    byKey[key] = { nombre: nameFor(key, data.expediente), cantidad: n, cedulas: 0 };
  }
  for (const [key, data] of Object.entries(cedulasByExpediente || {})) {
    const n = data?.cedulas?.length || 0;
    if (n === 0) continue;
    if (!byKey[key]) byKey[key] = { nombre: nameFor(key, data.expediente), cantidad: 0, cedulas: 0 };
    byKey[key].cedulas += n;
  }
  return Object.values(byKey);
}

function describeCounts({ cantidad, cedulas }, { short = false } = {}) {
  const parts = [];
  if (cantidad > 0) parts.push(short ? `${cantidad}` : `${cantidad} ${cantidad === 1 ? 'novedad' : 'novedades'}`);
  if (cedulas > 0) parts.push(`${cedulas} ${cedulas === 1 ? 'cédula' : 'cédulas'}`);
  return parts.join(short ? ', ' : ' y ');
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
  const { folderNameByExpediente = {}, cedulasByExpediente = {}, frontBaseUrl = DEFAULT_FRONT_BASE_URL } = options;
  const entries = digestEntries(movementsByExpediente, folderNameByExpediente, cedulasByExpediente);
  const total = entries.length;
  if (total === 0) return null;

  const lines = [`Tenés novedades en ${total} ${total === 1 ? 'carpeta' : 'carpetas'}:`, ''];
  for (const entry of entries.slice(0, MAX_LISTED)) {
    lines.push(`• ${entry.nombre} — ${describeCounts(entry)}`);
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
  const { folderNameByExpediente = {}, cedulasByExpediente = {} } = options;
  const entries = digestEntries(movementsByExpediente, folderNameByExpediente, cedulasByExpediente);
  const total = entries.length;
  if (total === 0) return null;

  const items = entries.slice(0, MAX_LISTED).map((entry) => `${entry.nombre} (${describeCounts(entry, { short: true })})`);
  if (total > MAX_LISTED) items.push(`y ${total - MAX_LISTED} más`);

  // Variante "una carpeta por línea" (plantillas aviso_novedades_1/2/3): resumen
  // + cantidad de carpetas + hasta 3 líneas; con más de 3 carpetas la tercera
  // línea es "…y N carpetas más" y el botón "Ver lista completa" trae el resto.
  const totalMov = entries.reduce((a, e) => a + e.cantidad, 0);
  const totalCed = entries.reduce((a, e) => a + e.cedulas, 0);
  const summaryParts = [];
  if (totalMov > 0) summaryParts.push(`${totalMov} ${totalMov === 1 ? 'movimiento nuevo' : 'movimientos nuevos'}`);
  if (totalCed > 0) summaryParts.push(`${totalCed} ${totalCed === 1 ? 'cédula' : 'cédulas'}`);
  const lineFor = (entry) => `${truncateName(entry.nombre, LINE_NAME_MAX)} — ${describeCounts(entry)}`;
  let lines;
  if (total <= 3) lines = entries.map(lineFor);
  else lines = [lineFor(entries[0]), lineFor(entries[1]), `…y ${total - 2} carpetas más`];

  return {
    count: String(total),
    folders: items.join(', ').replace(/[\n\r\t]+/g, ' ').replace(/ {4,}/g, '   '),
    ctaSuffix: DIGEST_CTA_PATH,
    summary: summaryParts.join(' y '),
    lines: lines.map(l => l.replace(/[\n\r\t]+/g, ' ').replace(/ {4,}/g, '   ')),
    variant: Math.min(total, 3),
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
