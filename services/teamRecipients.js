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

  return { resolveGroupRecipients, resolveUserTeamRecipients, resolveOwnerTeamRecipients };
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

  for (const f of Array.isArray(teamFolders) ? teamFolders : []) {
    if (!f || f.causaId == null) continue;
    const owner = f.userId != null ? String(f.userId) : null;
    const causa = String(f.causaId);
    const key = teamKeyOf(f);
    // Compatibilidad: mapa por groupId pelado (tests y llamadas previas) o por clave g:/o:
    const recipients = (key && recipientsByGroup.get(key)) || (f.groupId && recipientsByGroup.get(String(f.groupId))) || [];
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
  return { extraRecipients, folderPairs, reservedPairs, userIds: [...userIds] };
}

/**
 * Filtro Mongo de "a quién se le recuerda una tarea" para el usuario U:
 * a sus asignados (Task.assignedTo, responsables dentro del equipo) y, si no
 * tiene asignados, a su dueño (Task.userId). Función pura; se combina con el
 * resto del filtro (status, checked, rango de fechas) con spread.
 *
 * @param {string|ObjectId} userId
 * @returns {{ $or: Array<Object> }}
 */
function buildTaskRecipientFilter(userId) {
  const uid = toObjectId(userId) || userId;
  return {
    $or: [
      { assignedTo: uid },
      {
        userId: uid,
        $or: [
          { assignedTo: { $exists: false } },
          { assignedTo: { $size: 0 } }
        ]
      }
    ]
  };
}

module.exports = {
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
