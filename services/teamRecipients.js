/**
 * Destinatarios de equipo (feature "Equipos", colección `groups` en Atlas).
 *
 * Un recurso de equipo se guarda con Folder.userId = owner del grupo y
 * Folder.groupId. Decisión del dueño (29/10): en carpetas de grupo se avisa al
 * owner y a todos los miembros activos; cada destinatario pasa después por sus
 * propias preferencias en el job de envío, como hoy.
 *
 * Documento de `groups`:
 *   { _id, owner: ObjectId, status: 'active'|'suspended'|'archived'|'deleted',
 *     members: [{ userId, role, status: 'active'|'suspended'|'removed' }] }
 *
 * Sin modelo Mongoose: se lee la colección cruda vía `mongoose.connection.db`
 * (mismo patrón que judicialMovementCoordinator). Ambas funciones son
 * tolerantes a fallos: ante cualquier error loguean warn y devuelven el
 * fallback individual (vacío para el grupo, `[userId]` para el usuario).
 *
 * `createTeamRecipients(db)` permite inyectar una `db` falsa para testear sin
 * Mongo (ver tests/test-team-recipients.js).
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');

const GROUPS_COLLECTION = 'groups';

/**
 * Convierte un id (string u ObjectId) a ObjectId; null si no es válido.
 */
function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const str = String(id);
  return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
}

/**
 * Owner + miembros activos de un doc de grupo, sin duplicados, como strings.
 */
function recipientsFromGroupDoc(group) {
  const out = new Set();
  if (group.owner) out.add(String(group.owner));
  for (const m of Array.isArray(group.members) ? group.members : []) {
    if (m && m.userId && m.status === 'active') out.add(String(m.userId));
  }
  return [...out];
}

/**
 * Fábrica con `db` inyectable. `db` puede ser el objeto o una función que lo
 * devuelve (para resolver `mongoose.connection.db` en forma perezosa).
 */
function createTeamRecipients(db) {
  const getDb = typeof db === 'function' ? db : () => db;

  /**
   * Destinatarios de un grupo: owner + miembros `status:'active'` si el grupo
   * está `status:'active'`; [] si no existe o no está activo.
   *
   * @param {string|ObjectId} groupId
   * @param {Map} [cache] - cache por groupId para una pasada
   * @returns {Promise<string[]>} userIds (string)
   */
  async function resolveGroupRecipients(groupId, cache) {
    const key = `group:${String(groupId)}`;
    if (cache && cache.has(key)) return cache.get(key);

    let result = [];
    try {
      const oid = toObjectId(groupId);
      const database = getDb();
      if (oid && database) {
        const group = await database
          .collection(GROUPS_COLLECTION)
          .findOne({ _id: oid, status: 'active' }, { projection: { owner: 1, members: 1 } });
        if (group) result = recipientsFromGroupDoc(group);
      }
    } catch (error) {
      logger.warn(`[TeamRecipients] Error resolviendo grupo ${groupId}: ${error.message} — sin destinatarios de equipo`);
      result = [];
    }

    if (cache) cache.set(key, result);
    return result;
  }

  /**
   * Destinatarios de equipo de un usuario: si es owner o miembro activo de un
   * grupo activo, owner + miembros activos de ese grupo; si no, `[userId]`.
   * Supuesto: un usuario pertenece a un solo equipo (se toma el primero que
   * coincida).
   *
   * @param {string|ObjectId} userId
   * @param {Map} [cache] - cache por userId para una pasada
   * @returns {Promise<string[]>} userIds (string); siempre incluye a userId
   */
  async function resolveUserTeamRecipients(userId, cache) {
    const self = String(userId);
    const fallback = [self];
    const key = `user:${self}`;
    if (cache && cache.has(key)) return cache.get(key);

    let result = fallback;
    try {
      const oid = toObjectId(userId);
      const database = getDb();
      if (oid && database) {
        const group = await database.collection(GROUPS_COLLECTION).findOne(
          {
            status: 'active',
            $or: [
              { owner: oid },
              { members: { $elemMatch: { userId: oid, status: 'active' } } }
            ]
          },
          { projection: { owner: 1, members: 1 } }
        );
        if (group) {
          const recipients = recipientsFromGroupDoc(group);
          // El usuario origen siempre recibe su aviso, pase lo que pase con el grupo.
          if (!recipients.includes(self)) recipients.unshift(self);
          result = recipients;
        }
      }
    } catch (error) {
      logger.warn(`[TeamRecipients] Error resolviendo equipo del usuario ${self}: ${error.message} — se notifica solo al usuario`);
      result = fallback;
    }

    if (cache) cache.set(key, result);
    return result;
  }

  /**
   * Destinatarios por DUEÑO de una carpeta sin groupId: si ese usuario posee un grupo
   * activo, owner + miembros activos; si no, solo él. No aplica a carpetas propias de
   * un miembro (las de un miembro no son del equipo): por eso el filtro es por `owner`.
   */
  async function resolveOwnerTeamRecipients(ownerId, cache) {
    const self = String(ownerId);
    const fallback = [self];
    const key = `owner:${self}`;
    if (cache && cache.has(key)) return cache.get(key);

    let result = fallback;
    try {
      const oid = toObjectId(ownerId);
      const database = getDb();
      if (oid && database) {
        const group = await database.collection(GROUPS_COLLECTION).findOne(
          { status: 'active', owner: oid },
          { projection: { owner: 1, members: 1 } }
        );
        if (group) {
          const recipients = recipientsFromGroupDoc(group);
          if (!recipients.includes(self)) recipients.unshift(self);
          result = recipients;
        }
      }
    } catch (error) {
      logger.warn(`[TeamRecipients] Error resolviendo equipo del dueño ${self}: ${error.message} — se notifica solo al dueño`);
      result = fallback;
    }

    if (cache) cache.set(key, result);
    return result;
  }

  /**
   * Contexto de equipo (30/10/2026): { groupId, owner, recipients, settings } o null.
   * `recipients` = owner + miembros activos (strings); `settings` = settings.notifications
   * del grupo. Tres formas de llegar: por groupId, por dueño (owner) o por integrante.
   */
  async function findContext(filter, key, cache) {
    if (cache && cache.has(key)) return cache.get(key);
    let ctx = null;
    try {
      const database = getDb();
      if (database) {
        const g = await database.collection(GROUPS_COLLECTION).findOne(
          { status: 'active', ...filter },
          { projection: { owner: 1, members: 1, 'settings.notifications': 1 } }
        );
        if (g) ctx = contextFromGroupDoc(g);
      }
    } catch (error) {
      logger.warn(`[TeamRecipients] Error resolviendo contexto ${key}: ${error.message}`);
      ctx = null;
    }
    if (cache) cache.set(key, ctx);
    return ctx;
  }
  const resolveGroupContext = (groupId, cache) => {
    const oid = toObjectId(groupId);
    return oid ? findContext({ _id: oid }, `ctxg:${oid}`, cache) : Promise.resolve(null);
  };
  const resolveOwnerTeamContext = (ownerId, cache) => {
    const oid = toObjectId(ownerId);
    return oid ? findContext({ owner: oid }, `ctxo:${oid}`, cache) : Promise.resolve(null);
  };
  const resolveTeamContextForUser = (userId, cache) => {
    const oid = toObjectId(userId);
    return oid
      ? findContext({ $or: [{ owner: oid }, { members: { $elemMatch: { userId: oid, status: 'active' } } }] }, `ctxu:${oid}`, cache)
      : Promise.resolve(null);
  };
  /** Contexto de una carpeta: su grupo o el equipo activo que posee su dueño. */
  async function resolveFolderContext(folder, cache) {
    if (!folder) return null;
    if (folder.groupId) {
      const c = await resolveGroupContext(folder.groupId, cache);
      if (c) return c;
    }
    return folder.userId ? resolveOwnerTeamContext(folder.userId, cache) : null;
  }

  return {
    resolveGroupRecipients, resolveUserTeamRecipients, resolveOwnerTeamRecipients,
    resolveGroupContext, resolveOwnerTeamContext, resolveTeamContextForUser, resolveFolderContext
  };
}

/** Contexto a partir del doc crudo de `groups`. Función pura. */
function contextFromGroupDoc(group) {
  const n = (group.settings && group.settings.notifications) || {};
  return {
    groupId: String(group._id),
    owner: String(group.owner),
    recipients: recipientsFromGroupDoc(group),
    settings: {
      defaultPolicy: n.defaultPolicy === 'responsables' ? 'responsables' : 'todos',
      members: new Map((Array.isArray(n.members) ? n.members : [])
        .filter((m) => m && m.userId)
        .map((m) => [String(m.userId), m.mode]))
    }
  };
}

/**
 * Destinatarios de un aviso de una carpeta del equipo según las reglas (30/10/2026).
 * Función pura.
 *  - Regla de la carpeta: folder.notificationPolicy 'responsables' | 'todos'; 'equipo' o
 *    vacío → settings.defaultPolicy ('todos' por defecto).
 *  - Modo del integrante: 'todo' → siempre; 'solo_lo_mio' → solo si es responsable;
 *    'segun_carpeta' (default) → según la regla de la carpeta.
 *  - Regla 'responsables' sin responsables vigentes → todos (no se pierde el aviso).
 *  - Nunca vacío: si nadie queda, el owner.
 *
 * @param {{owner, recipients: string[], settings}} ctx contexto del equipo (null → [])
 * @param {{responsables?, notificationPolicy?}} folder
 * @returns {string[]}
 */
function applyFolderPolicy(ctx, folder) {
  if (!ctx) return [];
  const members = ctx.recipients || [];
  const active = new Set(members);
  const responsables = new Set(
    (Array.isArray(folder && folder.responsables) ? folder.responsables : [])
      .map(String)
      .filter((id) => active.has(id))
  );
  const fp = folder && folder.notificationPolicy;
  const policy = fp === 'responsables' || fp === 'todos' ? fp : (ctx.settings && ctx.settings.defaultPolicy) || 'todos';
  const folderWants = (uid) => policy === 'todos' || responsables.size === 0 || responsables.has(uid);
  const modes = (ctx.settings && ctx.settings.members) || new Map();
  const out = members.filter((uid) => {
    const mode = modes.get(uid) || 'segun_carpeta';
    if (mode === 'todo') return true;
    if (mode === 'solo_lo_mio') return responsables.has(uid);
    return folderWants(uid);
  });
  return out.length > 0 ? out : [ctx.owner];
}

/**
 * Destinatarios de un evento de calendario dentro de un equipo (30/10/2026). Función pura.
 * Ligado a una carpeta del equipo → regla de la carpeta. Sin carpeta → quien lo creó
 * (createdBy, o el dueño del evento); si ya no es integrante, el owner.
 */
function eventRecipients(ctx, event, folder) {
  if (!ctx) return event && event.userId ? [String(event.userId)] : [];
  if (folder) return applyFolderPolicy(ctx, folder);
  const creator = event && (event.createdBy || event.userId) ? String(event.createdBy || event.userId) : null;
  return creator && (ctx.recipients || []).includes(creator) ? [creator] : [ctx.owner];
}

// Instancia por defecto sobre la conexión real (resuelta en forma perezosa,
// porque al cargar el módulo la conexión todavía puede no existir).
const defaultInstance = createTeamRecipients(() => mongoose.connection.db);

/**
 * Pares usuario|causa de las carpetas de equipo, para el pre-filtro del
 * webhook de movimientos (routes/judicialMovements.js). Función pura.
 *
 * @param {Array<{userId, causaId, groupId, causaCredentialCovered}>} teamFolders
 *   carpetas con groupId (lean de Folder)
 * @param {Map<string, string[]>} recipientsByGroup groupId (string) → userIds
 *   (owner + miembros activos, ya resueltos por resolveGroupRecipients)
 * @returns {{
 *   extraRecipients: Map<string, string[]>, // 'owner|causa' → miembros distintos del owner
 *   folderPairs: Set<string>,               // 'destinatario|causa' con carpeta de equipo
 *   reservedPairs: Set<string>,             // 'destinatario|causa' sin cobertura en ninguna carpeta de equipo
 *   userIds: string[]                       // destinatarios de equipo distintos de los owners
 * }}
 */
/**
 * Clave de equipo de una carpeta: su grupo, o el dueño cuando no tiene groupId
 * (sus carpetas anteriores al equipo también son del equipo).
 */
function teamKeyOf(f) {
  if (!f) return null;
  if (f.groupId) return `g:${String(f.groupId)}`;
  return f.userId != null ? `o:${String(f.userId)}` : null;
}

function buildTeamPairs(teamFolders, recipientsByGroup) {
  const extraRecipients = new Map();
  const covered = new Set();
  const uncovered = new Set();
  const userIds = new Set();

  const ownerIncluded = new Set();
  const ownerExcluded = new Set();
  for (const f of Array.isArray(teamFolders) ? teamFolders : []) {
    if (!f || f.causaId == null) continue;
    const owner = f.userId != null ? String(f.userId) : null;
    const causa = String(f.causaId);
    const key = teamKeyOf(f);
    // Por carpeta (clave f:<folderId>, con las reglas de avisos aplicadas) o, por
    // compatibilidad, por groupId pelado o por clave g:/o: (todos los integrantes).
    const byFolder = f._id != null ? recipientsByGroup.get(`f:${String(f._id)}`) : undefined;
    const recipients = byFolder || (key && recipientsByGroup.get(key)) || (f.groupId && recipientsByGroup.get(String(f.groupId))) || [];
    if (byFolder && owner) {
      (byFolder.includes(owner) ? ownerIncluded : ownerExcluded).add(`${owner}|${causa}`);
    }
    const target = f.causaCredentialCovered === false ? uncovered : covered;
    for (const rid of recipients) {
      if (rid === owner) continue;
      target.add(`${rid}|${causa}`);
      userIds.add(rid);
      if (owner) {
        const key = `${owner}|${causa}`;
        const list = extraRecipients.get(key) || [];
        if (!list.includes(rid)) list.push(rid);
        extraRecipients.set(key, list);
      }
    }
  }

  // Misma regla que el coordinador: omitido solo si ninguna carpeta lo cubre.
  const reservedPairs = new Set([...uncovered].filter((p) => !covered.has(p)));
  const folderPairs = new Set([...covered, ...uncovered]);
  // Dueños que las reglas dejan afuera en TODAS sus carpetas de la causa.
  const excludedPairs = new Set([...ownerExcluded].filter((p) => !ownerIncluded.has(p)));
  return { extraRecipients, folderPairs, reservedPairs, excludedPairs, userIds: [...userIds] };
}

/**
 * Filtro Mongo de "a quién se le recuerda una tarea" para el usuario U:
 * a sus asignados (Task.assignedTo, responsables dentro del equipo) y, si no
 * tiene asignados, a quien la creó (Task.createdBy) o, sin creador, a su dueño (Task.userId). Función pura; se combina con el
 * resto del filtro (status, checked, rango de fechas) con spread.
 *
 * @param {string|ObjectId} userId
 * @returns {{ $or: Array<Object> }}
 */
function buildTaskRecipientFilter(userId) {
  const uid = toObjectId(userId) || userId;
  // Sin responsables (30/10/2026): a quien la creó; tareas sin createdBy (anteriores a
  // Equipos o personales) a su dueño, como antes.
  const sinResponsables = { $or: [{ assignedTo: { $exists: false } }, { assignedTo: { $size: 0 } }] };
  return {
    $or: [
      { assignedTo: uid },
      { $and: [sinResponsables, { createdBy: uid }] },
      { $and: [sinResponsables, { userId: uid }, { $or: [{ createdBy: { $exists: false } }, { createdBy: null }, { createdBy: uid }] }] }
    ]
  };
}

module.exports = {
  resolveGroupContext: defaultInstance.resolveGroupContext,
  resolveOwnerTeamContext: defaultInstance.resolveOwnerTeamContext,
  resolveTeamContextForUser: defaultInstance.resolveTeamContextForUser,
  resolveFolderContext: defaultInstance.resolveFolderContext,
  contextFromGroupDoc,
  applyFolderPolicy,
  eventRecipients,
  resolveGroupRecipients: defaultInstance.resolveGroupRecipients,
  resolveUserTeamRecipients: defaultInstance.resolveUserTeamRecipients,
  resolveOwnerTeamRecipients: defaultInstance.resolveOwnerTeamRecipients,
  createTeamRecipients,
  recipientsFromGroupDoc,
  buildTeamPairs,
  teamKeyOf,
  buildTaskRecipientFilter,
  GROUPS_COLLECTION
};
