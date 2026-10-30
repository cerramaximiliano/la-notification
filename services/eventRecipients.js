/**
 * Destinatarios de los recordatorios de eventos de calendario (Equipos, 30/10/2026).
 *
 * Los eventos del equipo se guardan con Event.userId = owner. Antes solo se le
 * recordaban al owner. Ahora:
 *  - Evento ligado a una carpeta del equipo → reglas de avisos de esa carpeta
 *    (teamRecipients.applyFolderPolicy).
 *  - Evento sin carpeta → quien lo creó (createdBy, o el owner).
 *  - Fuera de un equipo, nada cambia: cada uno recibe los suyos.
 *
 * Las marcas «ya avisado» son por destinatario en Event.notificationRecipients,
 * con el mismo módulo que las tareas (taskRecipientMarks): las marcas viejas del
 * evento valen como marcas del dueño (Event.userId).
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');
const { resolveTeamContextForUser, eventRecipients } = require('./teamRecipients');
const taskRecipientMarks = require('./taskRecipientMarks');

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const s = String(id);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

/**
 * Filtro por usuario para buscar los eventos candidatos de un destinatario y el
 * contexto de equipo (null fuera de un equipo).
 */
async function scopeEventsForRecipient(userId, cache) {
  const ctx = await resolveTeamContextForUser(userId, cache);
  const uid = toObjectId(userId) || userId;
  if (!ctx) return { ctx: null, userFilter: { userId: uid } };
  const ids = [...new Set([String(userId), ctx.owner])].map((id) => toObjectId(id) || id);
  return { ctx, userFilter: { userId: { $in: ids } } };
}

/**
 * Deja los eventos que le corresponden al destinatario según las reglas.
 * `loadFolders(ids)` es inyectable para testear sin Mongo; por defecto lee `folders`.
 */
async function keepEventsForRecipient(events, userId, ctx, loadFolders) {
  const list = Array.isArray(events) ? events : [];
  if (!ctx) return list;
  const U = String(userId);
  const folderIds = [...new Set(list.map((e) => e && e.folderId).filter(Boolean).map(String))];
  let folders = [];
  if (folderIds.length > 0) {
    try {
      folders = loadFolders
        ? await loadFolders(folderIds)
        : await mongoose.connection.db.collection('folders').find(
          { _id: { $in: folderIds.map(toObjectId).filter(Boolean) } },
          { projection: { userId: 1, groupId: 1, responsables: 1, notificationPolicy: 1, createdBy: 1 } }
        ).toArray();
    } catch (error) {
      logger.warn(`[EventRecipients] no se pudieron leer las carpetas: ${error.message}`);
      folders = [];
    }
  }
  const byId = new Map(folders.map((f) => [String(f._id), f]));
  return list.filter((e) => {
    if (!e) return false;
    // Eventos que no son del owner del equipo: solo los propios.
    if (String(e.userId) !== ctx.owner) return String(e.userId) === U;
    const f = e.folderId ? byId.get(String(e.folderId)) : null;
    const teamFolder = f && ((f.groupId && String(f.groupId) === ctx.groupId) || String(f.userId) === ctx.owner) ? f : null;
    return eventRecipients(ctx, e, teamFolder).includes(U);
  });
}

/**
 * Configuración efectiva (notifyOnceOnly, daysInAdvance) para un destinatario:
 * el dueño del evento sigue con la del evento; el resto, con la propia.
 */
function recipientSettings(event, userId, userSettings) {
  const base = userSettings || {};
  if (String(event.userId) === String(userId)) {
    return taskRecipientMarks.effectiveRecipientSettings(event, base);
  }
  return {
    notifyOnceOnly: Boolean(base.notifyOnceOnly),
    daysInAdvance: typeof base.daysInAdvance === 'number' ? base.daysInAdvance : 5
  };
}

module.exports = { scopeEventsForRecipient, keepEventsForRecipient, recipientSettings };
