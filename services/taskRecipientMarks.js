/**
 * Marcas de «ya notificada» por destinatario de una tarea (feature Equipos).
 *
 * Con responsables (Task.assignedTo) una tarea se le recuerda a varios usuarios
 * (ver buildTaskRecipientFilter en teamRecipients.js) y las marcas por tarea
 * (`browserAlertSent`, `notifications`) no alcanzan: el primero procesado marcaba
 * la tarea y el resto nunca recibía su aviso, y `notifyOnceOnly` valía para todos.
 * Desde el 29/10 cada destinatario tiene su entrada en `Task.notificationRecipients`:
 *
 *   { userId, browserAlertAt, browserCount, emailAt, emailCount }
 *
 * Reglas de compatibilidad:
 *  - Documento sin el campo (o vacío): las marcas viejas valen como marcas del
 *    DUEÑO (el flujo anterior solo notificaba a Task.userId). Para cualquier otro
 *    destinatario, sin entrada = nunca notificado.
 *  - En la primera escritura sobre un documento viejo se siembra la entrada del
 *    dueño a partir de las marcas viejas, así no se lo vuelve a notificar aunque
 *    el que dispare la primera escritura sea otro destinatario.
 *  - Las marcas viejas se siguen escribiendo (browserAlertSent, notifications) por
 *    compatibilidad con quien las lea; en tareas con el campo nuevo ya no deciden.
 *  - Configuración: `Task.notificationSettings` es un espejo de las preferencias
 *    del dueño que escribe este servicio (nadie lo edita desde el front). En tareas
 *    con responsables se ignora y cada destinatario usa sus propias preferencias;
 *    en tareas sin responsables (flujo individual) sigue mandando como antes.
 *
 * Todas las funciones son puras salvo markTaskRecipientNotified, que recibe el
 * modelo (inyectable para testear sin Mongo: tests/test-task-recipient-marks.js).
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');

const FIELD = 'notificationRecipients';

// Campos de la entrada por canal.
const CHANNELS = {
  browser: { at: 'browserAlertAt', count: 'browserCount' },
  email: { at: 'emailAt', count: 'emailCount' }
};

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const str = String(id);
  return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
}

function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

/** Fecha en formato YYYY-MM-DD (UTC), como la usa el resto del servicio. */
function toDateString(d) {
  if (!d) return '';
  const date = new Date(d);
  return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
}

/** La tarea tiene responsables (flujo de equipo). */
function hasAssignees(task) {
  return Array.isArray(task?.assignedTo) && task.assignedTo.length > 0;
}

/** La tarea ya tiene marcas por destinatario (campo nuevo presente y no vacío). */
function hasRecipientMarks(task) {
  return Array.isArray(task?.[FIELD]) && task[FIELD].length > 0;
}

/** Entrada del destinatario en el campo nuevo, o null. */
function findRecipientMark(task, userId) {
  if (!hasRecipientMarks(task)) return null;
  return task[FIELD].find((r) => r && sameId(r.userId, userId)) || null;
}

/** Última fecha de una notificación vieja del tipo dado (null si no hay). */
function lastLegacyDate(task, type) {
  const list = Array.isArray(task?.notifications) ? task.notifications : [];
  let last = null;
  for (const n of list) {
    if (!n || n.type !== type || !n.date) continue;
    const d = new Date(n.date);
    if (!isNaN(d.getTime()) && (!last || d > last)) last = d;
  }
  return last;
}

/** La tarea tiene alguna marca vieja (del flujo por tarea). */
function hasLegacyMarks(task) {
  return task?.browserAlertSent === true || !!lastLegacyDate(task, 'browser') || !!lastLegacyDate(task, 'email');
}

/**
 * Marcas viejas de la tarea leídas como marcas del dueño. `browserAlertSent: true`
 * sin registro con fecha se fecha con updatedAt (o createdAt) para que el «¿ya
 * fue hoy?» tenga algo razonable que mirar.
 */
function legacyOwnerMark(task) {
  if (!hasLegacyMarks(task)) return null;
  const browserRecords = (task.notifications || []).filter((n) => n && n.type === 'browser');
  const emailRecords = (task.notifications || []).filter((n) => n && n.type === 'email');
  let browserAlertAt = lastLegacyDate(task, 'browser');
  if (!browserAlertAt && task.browserAlertSent === true) {
    browserAlertAt = task.updatedAt ? new Date(task.updatedAt) : (task.createdAt ? new Date(task.createdAt) : new Date(0));
  }
  return {
    userId: toObjectId(task.userId) || task.userId,
    browserAlertAt: browserAlertAt || undefined,
    browserCount: browserAlertAt ? Math.max(browserRecords.length, 1) : 0,
    emailAt: lastLegacyDate(task, 'email') || undefined,
    emailCount: emailRecords.length
  };
}

/**
 * Marca efectiva del destinatario: su entrada nueva; si el documento no tiene el
 * campo nuevo y el destinatario es el dueño, las marcas viejas; si no, null.
 */
function resolveRecipientMark(task, userId) {
  const own = findRecipientMark(task, userId);
  if (own) return own;
  if (!hasRecipientMarks(task) && sameId(task?.userId, userId)) return legacyOwnerMark(task);
  return null;
}

/**
 * Configuración efectiva (notifyOnceOnly, daysInAdvance) para un destinatario.
 * Flujo individual: lo de la tarea manda sobre lo del usuario (como siempre).
 * Flujo de equipo: preferencias del propio destinatario.
 */
function effectiveRecipientSettings(task, userSettings) {
  const base = userSettings || {};
  // notifyOnceOnly ausente se lee como antes (falsy = se puede repetir); el
  // default `true` lo pone quien arma userSettings cuando el usuario no tiene nada.
  const fromUser = {
    notifyOnceOnly: Boolean(base.notifyOnceOnly),
    daysInAdvance: typeof base.daysInAdvance === 'number' ? base.daysInAdvance : 5
  };
  if (hasAssignees(task)) return fromUser;
  const ts = task?.notificationSettings || {};
  return {
    notifyOnceOnly: typeof ts.notifyOnceOnly === 'boolean' ? ts.notifyOnceOnly : fromUser.notifyOnceOnly,
    daysInAdvance: typeof ts.daysInAdvance === 'number' ? ts.daysInAdvance : fromUser.daysInAdvance
  };
}

/**
 * ¿Hay que avisarle esta tarea a este destinatario por este canal?
 * Misma regla que antes, pero mirando la marca del destinatario:
 *  - notifyOnceOnly y ya tiene marca → no.
 *  - sin notifyOnceOnly y la marca es de hoy → no.
 *  - forceDaily ignora lo anterior, salvo que la marca sea de hoy.
 *
 * @param {Object} p
 * @param {Object} p.task
 * @param {string|ObjectId} p.userId destinatario que se está procesando
 * @param {'browser'|'email'} p.channel
 * @param {boolean} p.notifyOnceOnly
 * @param {boolean} [p.forceDaily]
 * @param {string} [p.todayDateString] YYYY-MM-DD (UTC); default hoy
 */
function shouldNotifyRecipient({ task, userId, channel, notifyOnceOnly, forceDaily = false, todayDateString }) {
  const fields = CHANNELS[channel];
  if (!fields) throw new Error(`Canal desconocido: ${channel}`);
  const today = todayDateString || toDateString(new Date());
  const mark = resolveRecipientMark(task, userId);
  const at = mark && mark[fields.at] ? mark[fields.at] : null;
  const sentToday = !!at && toDateString(at) === today;

  if (forceDaily) return !sentToday;
  if (notifyOnceOnly && at) return false;
  if (!notifyOnceOnly && sentToday) return false;
  return true;
}

/**
 * Persiste la marca del destinatario para el canal dado.
 * 1. Si el documento es viejo (sin campo nuevo) y tiene marcas viejas, siembra la
 *    entrada del dueño (filtro atómico: solo si el campo sigue vacío en la base).
 * 2. Actualiza la entrada del destinatario (fecha + contador) o la inserta si no
 *    existe (filtro `$ne` para no duplicarla ante dos corridas pisadas).
 * Nunca lanza: ante error loguea y devuelve { success: false }.
 *
 * @param {Model} TaskModel modelo con updateOne (inyectable)
 * @param {Object} task documento en memoria, leído ANTES de cualquier escritura
 * @param {string|ObjectId} userId destinatario
 * @param {'browser'|'email'} channel
 * @param {{ now?: Date }} [options]
 */
async function markTaskRecipientNotified(TaskModel, task, userId, channel, options = {}) {
  const fields = CHANNELS[channel];
  if (!fields) throw new Error(`Canal desconocido: ${channel}`);
  const now = options.now || new Date();
  const uid = toObjectId(userId) || userId;
  const result = { success: true, seeded: false, inserted: false, updated: false };

  try {
    if (!hasRecipientMarks(task)) {
      const seed = legacyOwnerMark(task);
      if (seed && seed.userId) {
        const r = await TaskModel.updateOne(
          { _id: task._id, $or: [{ [FIELD]: { $exists: false } }, { [FIELD]: { $size: 0 } }] },
          { $set: { [FIELD]: [seed] } }
        );
        result.seeded = (r?.modifiedCount || 0) > 0;
      }
    }

    const upd = await TaskModel.updateOne(
      { _id: task._id, [`${FIELD}.userId`]: uid },
      {
        $set: { [`${FIELD}.$.${fields.at}`]: now },
        $inc: { [`${FIELD}.$.${fields.count}`]: 1 }
      }
    );
    if ((upd?.matchedCount || 0) > 0) {
      result.updated = true;
      return result;
    }

    const ins = await TaskModel.updateOne(
      { _id: task._id, [`${FIELD}.userId`]: { $ne: uid } },
      { $push: { [FIELD]: { userId: uid, [fields.at]: now, [fields.count]: 1 } } }
    );
    result.inserted = (ins?.modifiedCount || 0) > 0;
    return result;
  } catch (error) {
    logger.warn(`[TaskRecipientMarks] No se pudo marcar la tarea ${task?._id} para ${String(userId)} (${channel}): ${error.message}`);
    return { ...result, success: false, error: error.message };
  }
}

module.exports = {
  FIELD,
  CHANNELS,
  hasAssignees,
  hasRecipientMarks,
  hasLegacyMarks,
  findRecipientMark,
  legacyOwnerMark,
  resolveRecipientMark,
  effectiveRecipientSettings,
  shouldNotifyRecipient,
  markTaskRecipientNotified,
  toDateString
};
