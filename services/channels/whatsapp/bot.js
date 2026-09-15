/**
 * Bot conversacional de WhatsApp — v1.5 (sin IA).
 *
 * Responde a los mensajes de texto de usuarios verificados (la baja y la
 * verificación las resuelve antes el controller). Solo habla dentro de la
 * ventana de 24 h que abre el propio mensaje del usuario: texto libre y
 * mensajes interactivos, gratis en Meta.
 *
 * Menú (lista interactiva en Meta; texto numerado en Baileys o si Meta la
 * rechaza). Se elige tocando la opción o escribiendo el número/palabra:
 *   1 novedades     movimientos nuevos en las últimas 24 h
 *   2 semana        movimientos de los últimos 7 días, por carpeta
 *   3 buscar        últimos movimientos de una carpeta (pide el texto a buscar)
 *   4 cedulas       cédulas / notificaciones electrónicas de los últimos 7 días
 *   5 vencimientos  tareas que vencen en los próximos 7 días
 *   6 agenda        eventos de los próximos 7 días
 *   7 cuenta        estado del canal para el usuario (número, avisos, plan/prueba)
 *   8 ayuda         qué hace el bot
 * "BAJA" sigue siendo por texto (controller) — no va como botón a propósito.
 *
 * Estado conversacional mínimo en WhatsAppContact.bot (pendingIntent): "buscar"
 * espera el siguiente mensaje como texto de búsqueda (vence a los 10 min).
 *
 * v2 (planificado): Claude con tools de la-mcp-server y recepción de documentos.
 */

const logger = require('../../../config/logger');
const { JudicialMovement, JudicialCedula, Task, Event, Folder, WhatsAppContact } = require('../../../models');
const { buildMovementDigestText } = require('./templates');
const { resolveAccess } = require('./access');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOVEDADES_WINDOW_HOURS = 24;
const WEEK_DAYS = 7;
const FALLBACK_MAX_PER_DAY = 3;
const BOT_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_ITEMS = 10;
const FRONT_BASE_URL = (process.env.FRONTEND_URL || 'https://www.lawanalytics.app').replace(/\/$/, '');
const TZ = 'America/Argentina/Buenos_Aires';

// ---------- menú ----------
const MENU = [
  { id: 'novedades', n: 1, title: 'Novedades', description: 'Movimientos nuevos en las últimas 24 h', words: ['NOVEDADES', 'NOVEDAD', 'MOVIMIENTOS', 'MOVIMIENTO', 'NOVEDADES DE HOY', 'HOY'] },
  { id: 'semana', n: 2, title: 'Esta semana', description: 'Movimientos de los últimos 7 días, por carpeta', words: ['SEMANA', 'ESTA SEMANA', 'ULTIMOS 7 DIAS'] },
  { id: 'buscar', n: 3, title: 'Buscar carpeta', description: 'Últimos movimientos de una carpeta', words: ['BUSCAR', 'BUSCAR CARPETA', 'CARPETA', 'EXPEDIENTE'] },
  { id: 'cedulas', n: 4, title: 'Cédulas', description: 'Notificaciones electrónicas de los últimos 7 días', words: ['CEDULAS', 'CEDULA', 'NOTIFICACIONES'] },
  { id: 'vencimientos', n: 5, title: 'Vencimientos', description: 'Tareas que vencen en los próximos 7 días', words: ['VENCIMIENTOS', 'VENCIMIENTO', 'TAREAS', 'TAREA', 'PLAZOS'] },
  { id: 'agenda', n: 6, title: 'Agenda', description: 'Audiencias y eventos de los próximos 7 días', words: ['AGENDA', 'EVENTOS', 'AUDIENCIAS', 'CALENDARIO'] },
  { id: 'cuenta', n: 7, title: 'Mi cuenta', description: 'Número, avisos y plan', words: ['CUENTA', 'MI CUENTA', 'ESTADO', 'PLAN'] },
  { id: 'ayuda', n: 8, title: 'Ayuda', description: 'Qué puedo hacer por acá', words: ['AYUDA', 'MENU', 'HOLA', 'BUENAS', 'BUEN DIA', 'BUENOS DIAS', 'BUENAS TARDES', 'BUENAS NOCHES', 'INFO', '?', '0', 'INICIO'] },
];
const MENU_BY_ID = Object.fromEntries(MENU.map(m => [m.id, m]));

function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * @returns {{ intent: string, arg?: string }}  intent = id del menú | 'fallback'
 */
function detectIntent(text, replyId = null) {
  if (replyId && MENU_BY_ID[replyId]) return { intent: replyId };
  const norm = normalize(text);
  if (!norm) return { intent: 'fallback' };
  const byNumber = MENU.find(m => String(m.n) === norm);
  if (byNumber) return { intent: byNumber.id };
  for (const m of MENU) if (m.words.includes(norm)) return { intent: m.id };
  // "carpeta perez" / "buscar 1234/2024" → búsqueda directa
  const search = /^(BUSCAR CARPETA|BUSCAR|CARPETA|EXPEDIENTE)\s+(.+)$/.exec(norm);
  if (search) return { intent: 'buscar', arg: String(text).trim().replace(/^\S+\s+(carpeta\s+)?/i, '') };
  if (/\b(NOVEDAD|NOVEDADES|MOVIMIENTO|MOVIMIENTOS)\b/.test(norm) && norm.split(' ').length <= 6) return { intent: 'novedades' };
  if (/\b(CEDULA|CEDULAS)\b/.test(norm) && norm.split(' ').length <= 5) return { intent: 'cedulas' };
  if (/\b(VENCE|VENCEN|VENCIMIENTO|VENCIMIENTOS|TAREAS)\b/.test(norm) && norm.split(' ').length <= 6) return { intent: 'vencimientos' };
  if (/\b(AGENDA|AUDIENCIA|AUDIENCIAS|EVENTOS)\b/.test(norm) && norm.split(' ').length <= 6) return { intent: 'agenda' };
  return { intent: 'fallback' };
}

// ---------- helpers ----------
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: TZ }) : '');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '');
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const truncate = (s, n) => (clean(s).length > n ? `${clean(s).slice(0, n - 1)}…` : clean(s));
const link = (path, source) => `${FRONT_BASE_URL}/${path}?source=${source}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function expedienteKey(m) {
  return m.expediente?.id || `${m.expediente?.number}/${m.expediente?.year ?? ''}`;
}

async function folderNamesFor(userId, causaIds) {
  if (!causaIds.length) return {};
  const folders = await Folder.find({ userId, causaId: { $in: causaIds } }).select('causaId folderName').lean();
  const map = {};
  for (const f of folders) if (f.causaId && f.folderName) map[String(f.causaId)] = f.folderName;
  return map;
}

function groupByExpediente(movements) {
  const grouped = {};
  for (const m of movements) {
    const key = expedienteKey(m);
    if (!grouped[key]) grouped[key] = { expediente: m.expediente, movements: [] };
    grouped[key].movements.push(m);
  }
  return grouped;
}

function labelFor(grouped, key, folderNames) {
  const exp = grouped[key]?.expediente || {};
  return clean(folderNames[key]) || clean(exp.caratula) || `${exp.number ?? '?'}/${exp.year ?? ''}`;
}

// ---------- consultas ----------
async function novedades(userId) {
  const since = new Date(Date.now() - NOVEDADES_WINDOW_HOURS * 60 * 60 * 1000);
  const movements = await JudicialMovement.find({ userId, createdAt: { $gte: since }, notificationStatus: { $ne: 'skipped' } })
    .select('expediente movimiento').lean();
  if (movements.length === 0) {
    return [`No hay movimientos nuevos en tus carpetas en las últimas ${NOVEDADES_WINDOW_HOURS} horas.`, `Ver tus carpetas: ${link('apps/folders/list', 'whatsapp_bot')}`].join('\n');
  }
  const grouped = groupByExpediente(movements);
  const folderNameByExpediente = await folderNamesFor(userId, Object.keys(grouped));
  return buildMovementDigestText(grouped, { folderNameByExpediente });
}

async function semana(userId) {
  const since = new Date(Date.now() - WEEK_DAYS * DAY_MS);
  const movements = await JudicialMovement.find({ userId, createdAt: { $gte: since }, notificationStatus: { $ne: 'skipped' } })
    .select('expediente movimiento').sort({ 'movimiento.fecha': -1 }).lean();
  if (movements.length === 0) {
    return [`Sin movimientos en tus carpetas en los últimos ${WEEK_DAYS} días.`, `Ver tus carpetas: ${link('apps/folders/list', 'whatsapp_bot')}`].join('\n');
  }
  const grouped = groupByExpediente(movements);
  const folderNames = await folderNamesFor(userId, Object.keys(grouped));
  const entries = Object.keys(grouped)
    .map(key => ({ key, count: grouped[key].movements.length, last: grouped[key].movements[0] }))
    .sort((a, b) => new Date(b.last.movimiento?.fecha) - new Date(a.last.movimiento?.fecha));
  const lines = [`Últimos ${WEEK_DAYS} días: ${plural(movements.length, 'movimiento', 'movimientos')} en ${plural(entries.length, 'carpeta', 'carpetas')}.`, ''];
  for (const e of entries.slice(0, MAX_ITEMS)) {
    lines.push(`• ${truncate(labelFor(grouped, e.key, folderNames), 70)} — ${e.count} (último ${fmtDate(e.last.movimiento?.fecha)}: ${truncate(e.last.movimiento?.tipo, 40)})`);
  }
  if (entries.length > MAX_ITEMS) lines.push(`…y ${plural(entries.length - MAX_ITEMS, 'carpeta más', 'carpetas más')}`);
  lines.push('', `Ver el detalle: ${link('apps/folders/list', 'whatsapp_bot')}`);
  return lines.join('\n');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function buscar(userId, query) {
  const q = clean(query);
  if (q.length < 2) return 'Escribí al menos 2 caracteres del nombre de la carpeta, la carátula o el número de expediente.';
  const re = new RegExp(escapeRegex(q), 'i');
  const folders = await Folder.find({
    userId,
    $or: [{ folderName: re }, { numberJudFolder: re }],
  }).select('folderName causaId numberJudFolder archived').limit(6).lean();

  // También por carátula/número de expediente en los movimientos ya vistos.
  let matches = folders.map(f => ({ folderName: f.folderName, causaId: f.causaId ? String(f.causaId) : null, archived: f.archived }));
  if (matches.length === 0) {
    const byCaratula = await JudicialMovement.aggregate([
      { $match: { userId, $or: [{ 'expediente.caratula': re }, ...(/^\d+$/.test(q) ? [{ 'expediente.number': Number(q) }] : [])] } },
      { $group: { _id: '$expediente.id', caratula: { $first: '$expediente.caratula' } } },
      { $limit: 6 },
    ]);
    matches = byCaratula.map(x => ({ folderName: x.caratula, causaId: x._id, archived: false }));
  }

  if (matches.length === 0) return `No encontré ninguna carpeta con "${truncate(q, 40)}". Probá con otra parte del nombre o el número de expediente.`;
  if (matches.length > 1) {
    const lines = [`Encontré ${matches.length} carpetas con "${truncate(q, 40)}". Escribí *carpeta* y algo más específico:`, ''];
    for (const m of matches) lines.push(`• ${truncate(m.folderName, 60)}${m.archived ? ' (archivada)' : ''}`);
    return lines.join('\n');
  }

  const target = matches[0];
  if (!target.causaId) return `La carpeta *${truncate(target.folderName, 60)}* no tiene una causa vinculada, así que no tengo movimientos para mostrar. Ver la carpeta: ${link('apps/folders/list', 'whatsapp_bot')}`;
  const movements = await JudicialMovement.find({ userId, 'expediente.id': target.causaId })
    .select('movimiento').sort({ 'movimiento.fecha': -1 }).limit(3).lean();
  const lines = [`*${truncate(target.folderName, 60)}*${target.archived ? ' (archivada)' : ''}`, ''];
  if (movements.length === 0) {
    lines.push('Todavía no registré movimientos de esta causa.');
  } else {
    lines.push('Últimos movimientos:');
    for (const m of movements) lines.push(`• ${fmtDate(m.movimiento?.fecha)} — ${truncate(m.movimiento?.tipo, 40)}${m.movimiento?.detalle ? `: ${truncate(m.movimiento.detalle, 90)}` : ''}`);
  }
  lines.push('', `Ver la carpeta: ${link('apps/folders/list', 'whatsapp_bot')}`);
  return lines.join('\n');
}

async function cedulas(userId) {
  const since = new Date(Date.now() - WEEK_DAYS * DAY_MS);
  const items = await JudicialCedula.find({ userId, 'cedula.fecha': { $gte: since }, notificationStatus: { $ne: 'skipped' } })
    .select('expediente cedula').sort({ 'cedula.fecha': -1 }).limit(MAX_ITEMS + 1).lean();
  if (items.length === 0) return `Sin cédulas ni notificaciones electrónicas en los últimos ${WEEK_DAYS} días.`;
  // Varias cédulas del mismo día y carátula se ven iguales: se agrupan con el conteo.
  const groups = [];
  for (const c of items) {
    const key = `${fmtDate(c.cedula?.fecha)}|${c.expediente?.id || c.expediente?.caratula}`;
    const g = groups.find(x => x.key === key);
    if (g) g.count += 1;
    else groups.push({ key, fecha: c.cedula?.fecha, caratula: c.expediente?.caratula, tipo: c.cedula?.tipo, count: 1 });
  }
  const lines = [`Cédulas de los últimos ${WEEK_DAYS} días:`, ''];
  for (const g of groups.slice(0, MAX_ITEMS)) {
    const tipo = g.tipo && g.tipo !== 'Cédula' ? ` (${truncate(g.tipo, 30)})` : '';
    lines.push(`• ${fmtDate(g.fecha)} — ${truncate(g.caratula, 60)}${tipo}${g.count > 1 ? ` — ${g.count} cédulas` : ''}`);
  }
  if (groups.length > MAX_ITEMS) lines.push('…y más');
  lines.push('', `Ver el detalle: ${link('apps/folders/list', 'whatsapp_bot')}`);
  return lines.join('\n');
}

async function vencimientos(userId) {
  const now = new Date();
  const until = new Date(now.getTime() + WEEK_DAYS * DAY_MS);
  const tasks = await Task.find({
    userId,
    dueDate: { $gte: new Date(now.getTime() - DAY_MS), $lte: until },
    status: { $nin: ['completada', 'cancelada'] },
    checked: { $ne: true },
  }).select('name dueDate dueTime priority folderId').sort({ dueDate: 1 }).limit(MAX_ITEMS + 1).lean();
  if (tasks.length === 0) return `No tenés tareas que venzan en los próximos ${WEEK_DAYS} días.`;
  const folderIds = [...new Set(tasks.map(t => t.folderId && String(t.folderId)).filter(Boolean))];
  const folders = folderIds.length ? await Folder.find({ _id: { $in: folderIds } }).select('folderName').lean() : [];
  const folderName = Object.fromEntries(folders.map(f => [String(f._id), f.folderName]));
  const lines = [`Vencimientos de los próximos ${WEEK_DAYS} días:`, ''];
  for (const t of tasks.slice(0, MAX_ITEMS)) {
    const when = `${fmtDate(t.dueDate)}${t.dueTime ? ` ${t.dueTime}` : ''}`;
    const folder = t.folderId && folderName[String(t.folderId)] ? ` — ${truncate(folderName[String(t.folderId)], 40)}` : '';
    lines.push(`• ${when}: ${truncate(t.name, 60)}${folder}${t.priority === 'alta' ? ' ‼️' : ''}`);
  }
  if (tasks.length > MAX_ITEMS) lines.push('…y más');
  lines.push('', `Ver tareas: ${link('apps/folders/list', 'whatsapp_bot')}`);
  return lines.join('\n');
}

async function agenda(userId) {
  const now = new Date();
  const until = new Date(now.getTime() + WEEK_DAYS * DAY_MS);
  const events = await Event.find({ userId, start: { $gte: new Date(now.getTime() - 60 * 60 * 1000), $lte: until } })
    .select('title start end allDay type folderId').sort({ start: 1 }).limit(MAX_ITEMS * 6).lean();
  // Importaciones viejas de Google dejaron el mismo evento repetido: se muestra una vez.
  const unique = [];
  const seen = new Set();
  for (const e of events) {
    const key = `${clean(e.title).toLowerCase()}|${new Date(e.start).getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  if (unique.length === 0) return `No tenés eventos en la agenda para los próximos ${WEEK_DAYS} días.`;
  const lines = [`Agenda de los próximos ${WEEK_DAYS} días:`, ''];
  for (const e of unique.slice(0, MAX_ITEMS)) {
    const when = e.allDay ? fmtDate(e.start) : fmtDateTime(e.start);
    const tipo = e.type && !['google', 'manual'].includes(String(e.type).toLowerCase()) ? ` (${truncate(e.type, 20)})` : '';
    lines.push(`• ${when}: ${truncate(e.title, 60)}${tipo}`);
  }
  if (unique.length > MAX_ITEMS) lines.push('…y más');
  lines.push('', `Ver calendario: ${link('apps/calendar', 'whatsapp_bot')}`);
  return lines.join('\n');
}

async function cuenta(user, instance) {
  const access = await resolveAccess(user);
  const optIn = user.whatsappOptIn || {};
  const channelOn = user.preferences?.notifications?.channels?.whatsapp === true && optIn.accepted === true && !optIn.revokedAt;
  const masked = user.phone ? `${user.phone.slice(0, 4)}…${user.phone.slice(-4)}` : '—';
  let plan;
  if (access.reason === 'grant') plan = 'acceso habilitado por Law||Analytics';
  else if (access.reason === 'plan') plan = `incluido en tu plan ${access.plan}`;
  else if (access.reason === 'trial') plan = `prueba gratis hasta el ${fmtDate(access.trialEndsAt)}`;
  else if (access.reason === 'trial_expired') plan = `prueba vencida el ${fmtDate(access.trialEndsAt)} — requiere plan Estándar o superior`;
  else plan = 'requiere plan Estándar o superior';
  return [
    'Tu cuenta de WhatsApp en Law||Analytics:',
    '',
    `• Número verificado: ${masked}`,
    `• Avisos de novedades: ${channelOn ? 'activados' : 'pausados'}`,
    `• Acceso: ${plan}`,
    instance?.label ? `• Línea: ${instance.label}` : null,
    '',
    channelOn ? 'Para dejar de recibir avisos, respondé *BAJA*.' : `Para volver a activarlos: ${link('apps/profiles/user/settings', 'whatsapp_bot')}`,
  ].filter(l => l !== null).join('\n');
}

function ayudaText(name) {
  const saludo = name ? `Hola ${name}.` : 'Hola.';
  return [
    `${saludo} Soy el asistente de Law||Analytics. Escribí el número o la palabra:`,
    '',
    ...MENU.filter(m => m.id !== 'ayuda').map(m => `${m.n}. *${m.title}* — ${m.description}`),
    '',
    'También podés escribir *carpeta <nombre o expediente>* directamente.',
    'Para dejar de recibir avisos, respondé *BAJA*.',
    `App: ${link('apps/folders/list', 'whatsapp_bot')}`,
  ].join('\n');
}

// Lista interactiva de Meta (máx. 10 filas; título ≤24, descripción ≤72 chars).
function menuInteractive(name) {
  return {
    type: 'list',
    header: { type: 'text', text: 'Law||Analytics' },
    body: { text: `${name ? `Hola ${name}. ` : ''}¿Qué querés consultar?` },
    footer: { text: 'Para dejar de recibir avisos, respondé BAJA' },
    action: {
      button: 'Ver opciones',
      sections: [{
        title: 'Consultas',
        rows: MENU.map(m => ({ id: m.id, title: m.title.slice(0, 24), description: m.description.slice(0, 72) })),
      }],
    },
  };
}

// ---------- estado conversacional ----------
async function getPendingIntent(phone) {
  const c = await WhatsAppContact.findOne({ phone }).select('bot').lean();
  const p = c?.bot?.pendingIntent;
  if (!p) return null;
  if (!c.bot.pendingSince || Date.now() - new Date(c.bot.pendingSince).getTime() > BOT_STATE_TTL_MS) return null;
  return p;
}

async function setPendingIntent(phone, intent) {
  await WhatsAppContact.updateOne({ phone }, { $set: { 'bot.pendingIntent': intent, 'bot.pendingSince': intent ? new Date() : null } }).catch(() => {});
}

/**
 * Decide la respuesta para un texto de un usuario verificado con acceso.
 * @returns {Promise<{ handledAs: string, text: string|null, interactive?: object|null, countsAsFallback: boolean }>}
 */
async function respond({ user, text, replyId = null, instance = null }) {
  const firstName = user?.name?.split(' ')[0];
  let { intent, arg } = detectIntent(text, replyId);

  // Paso 2 de "buscar": el mensaje anterior pidió el texto a buscar.
  if (intent === 'fallback' && user?.phone) {
    const pending = await getPendingIntent(user.phone);
    if (pending === 'buscar') {
      intent = 'buscar';
      arg = String(text || '').trim();
    }
  }
  if (user?.phone) await setPendingIntent(user.phone, null);

  try {
    switch (intent) {
      case 'novedades': return { handledAs: 'bot_novedades', text: await novedades(user._id), countsAsFallback: false };
      case 'semana': return { handledAs: 'bot_semana', text: await semana(user._id), countsAsFallback: false };
      case 'buscar':
        if (!arg) {
          await setPendingIntent(user.phone, 'buscar');
          return { handledAs: 'bot_buscar_ask', text: 'Escribí parte del nombre de la carpeta, la carátula o el número de expediente.', countsAsFallback: false };
        }
        return { handledAs: 'bot_buscar', text: await buscar(user._id, arg), countsAsFallback: false };
      case 'cedulas': return { handledAs: 'bot_cedulas', text: await cedulas(user._id), countsAsFallback: false };
      case 'vencimientos': return { handledAs: 'bot_vencimientos', text: await vencimientos(user._id), countsAsFallback: false };
      case 'agenda': return { handledAs: 'bot_agenda', text: await agenda(user._id), countsAsFallback: false };
      case 'cuenta': return { handledAs: 'bot_cuenta', text: await cuenta(user, instance), countsAsFallback: false };
      case 'ayuda':
        return { handledAs: 'bot_menu', text: ayudaText(firstName), interactive: menuInteractive(firstName), countsAsFallback: true };
      default:
        return { handledAs: 'bot_fallback', text: ayudaText(firstName), interactive: menuInteractive(firstName), countsAsFallback: true };
    }
  } catch (error) {
    logger.warn(`[WhatsApp bot] Error respondiendo '${intent}' a ${user?._id}: ${error.message}`);
    return { handledAs: 'bot_error', text: 'No pude consultar tus datos en este momento. Probá de nuevo en unos minutos.', countsAsFallback: false };
  }
}

module.exports = {
  respond,
  detectIntent,
  FALLBACK_MAX_PER_DAY,
  MENU,
  _internal: { normalize, ayudaText, menuInteractive, novedades, semana, buscar, cedulas, vencimientos, agenda, cuenta },
};
