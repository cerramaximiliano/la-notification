/**
 * Destinatarios de equipo (2026-10-29) — sin DB.
 *
 * Prueba services/teamRecipients.js con una `db` falsa que solo implementa
 * collection().findOne, inyectada vía createTeamRecipients(db):
 *  1. grupo activo con 2 miembros activos y 1 removido → owner + 2 activos
 *  2. grupo suspendido → []
 *  3. usuario sin grupo → [userId]
 *  4. cache evita la segunda consulta (grupo y usuario)
 *  5. error de la db → fallback individual ([] / [userId])
 *  6. getUsersForCausa suma los destinatarios del equipo con la cobertura de
 *     la carpeta y cuenta stats.destinatariosEquipo (Folder y db falsos)
 *  7. buildTeamPairs (pre-filtro del webhook): destinatarios extra por
 *     owner|causa, pares con carpeta y pares reservados por cobertura
 *  8. buildTaskRecipientFilter: asignados, o dueño sin asignados; el schema
 *     de Task declara assignedTo
 *
 * Uso: node tests/test-team-recipients.js
 */
process.env.NODE_ENV = 'test';
const assert = require('assert');
const path = require('path');
const mongoose = require('mongoose');
const { createTeamRecipients, buildTeamPairs, buildTaskRecipientFilter } = require(path.join(__dirname, '..', 'services', 'teamRecipients'));

let ok = 0;
let fail = 0;
const test = (titulo, fn) => Promise.resolve().then(fn).then(
  () => { ok++; console.log(`  ✓ ${titulo}`); },
  (err) => { fail++; console.log(`  ✗ ${titulo}\n    ${err && err.message}`); }
);

const oid = () => new mongoose.Types.ObjectId();
const OWNER = oid();
const M_ACTIVO_1 = oid();
const M_ACTIVO_2 = oid();
const M_REMOVIDO = oid();
const SIN_GRUPO = oid();

const grupoActivo = {
  _id: oid(),
  owner: OWNER,
  status: 'active',
  members: [
    { userId: M_ACTIVO_1, role: 'member', status: 'active' },
    { userId: M_ACTIVO_2, role: 'admin', status: 'active' },
    { userId: M_REMOVIDO, role: 'member', status: 'removed' }
  ]
};
const grupoSuspendido = { ...grupoActivo, _id: oid(), status: 'suspended' };

/**
 * db falsa: findOne evalúa el filtro que usa el servicio sobre una lista de
 * grupos en memoria. Cuenta las llamadas para verificar el cache.
 */
function fakeDb(groups, { throws = false } = {}) {
  const calls = { findOne: 0 };
  const matches = (g, filter) => {
    if (filter.status && g.status !== filter.status) return false;
    if (filter._id && String(g._id) !== String(filter._id)) return false;
    if (filter.owner && String(g.owner) !== String(filter.owner)) return false;
    if (filter.$or) {
      return filter.$or.some((cond) => {
        if (cond.owner) return String(g.owner) === String(cond.owner);
        if (cond.members && cond.members.$elemMatch) {
          const { userId, status } = cond.members.$elemMatch;
          return (g.members || []).some((m) => String(m.userId) === String(userId) && m.status === status);
        }
        return false;
      });
    }
    return true;
  };
  const db = {
    collection: (name) => {
      assert.strictEqual(name, 'groups');
      return {
        findOne: async (filter) => {
          calls.findOne++;
          if (throws) throw new Error('db caída (simulada)');
          return groups.find((g) => matches(g, filter)) || null;
        }
      };
    }
  };
  return { db, calls };
}

const esperados = [String(OWNER), String(M_ACTIVO_1), String(M_ACTIVO_2)].sort();

(async () => {
  await test('1. grupo activo: owner + 2 miembros activos, sin el removido', async () => {
    const { db } = fakeDb([grupoActivo]);
    const { resolveGroupRecipients } = createTeamRecipients(db);
    const r = await resolveGroupRecipients(grupoActivo._id);
    assert.deepStrictEqual([...r].sort(), esperados);
    assert.ok(r.every((x) => typeof x === 'string'));
  });

  await test('2. grupo suspendido → []; grupo inexistente → []', async () => {
    const { db } = fakeDb([grupoSuspendido]);
    const { resolveGroupRecipients } = createTeamRecipients(db);
    assert.deepStrictEqual(await resolveGroupRecipients(grupoSuspendido._id), []);
    assert.deepStrictEqual(await resolveGroupRecipients(oid()), []);
    assert.deepStrictEqual(await resolveGroupRecipients('no-es-un-id'), []);
  });

  await test('3. usuario sin grupo → [userId]; miembro activo y owner → equipo completo', async () => {
    const { db } = fakeDb([grupoActivo, grupoSuspendido]);
    const { resolveUserTeamRecipients } = createTeamRecipients(db);
    assert.deepStrictEqual(await resolveUserTeamRecipients(SIN_GRUPO), [String(SIN_GRUPO)]);
    assert.deepStrictEqual((await resolveUserTeamRecipients(M_ACTIVO_1)).sort(), esperados);
    assert.deepStrictEqual((await resolveUserTeamRecipients(String(OWNER))).sort(), esperados);
    // El removido no arrastra al equipo: solo él.
    assert.deepStrictEqual(await resolveUserTeamRecipients(M_REMOVIDO), [String(M_REMOVIDO)]);
  });

  await test('3b. miembro de un grupo suspendido → solo él', async () => {
    const { db } = fakeDb([grupoSuspendido]);
    const { resolveUserTeamRecipients } = createTeamRecipients(db);
    assert.deepStrictEqual(await resolveUserTeamRecipients(M_ACTIVO_1), [String(M_ACTIVO_1)]);
  });

  await test('4. cache: la segunda consulta del mismo grupo/usuario no toca la db', async () => {
    const { db, calls } = fakeDb([grupoActivo]);
    const { resolveGroupRecipients, resolveUserTeamRecipients } = createTeamRecipients(db);
    const cache = new Map();
    await resolveGroupRecipients(grupoActivo._id, cache);
    await resolveGroupRecipients(String(grupoActivo._id), cache);
    assert.strictEqual(calls.findOne, 1);
    await resolveUserTeamRecipients(SIN_GRUPO, cache);
    await resolveUserTeamRecipients(SIN_GRUPO, cache);
    assert.strictEqual(calls.findOne, 2);
    // Sin cache, cada llamada consulta.
    await resolveGroupRecipients(grupoActivo._id);
    assert.strictEqual(calls.findOne, 3);
  });

  await test('5. error de la db → fallback individual sin explotar', async () => {
    const { db } = fakeDb([grupoActivo], { throws: true });
    const { resolveGroupRecipients, resolveUserTeamRecipients } = createTeamRecipients(db);
    assert.deepStrictEqual(await resolveGroupRecipients(grupoActivo._id), []);
    assert.deepStrictEqual(await resolveUserTeamRecipients(OWNER), [String(OWNER)]);
    // db ausente (conexión no inicializada) también cae al fallback.
    const sinDb = createTeamRecipients(() => undefined);
    assert.deepStrictEqual(await sinDb.resolveGroupRecipients(grupoActivo._id), []);
    assert.deepStrictEqual(await sinDb.resolveUserTeamRecipients(OWNER), [String(OWNER)]);
  });

  await test('6. getUsersForCausa: carpeta de equipo suma miembros con la cobertura de la carpeta', async () => {
    // Inyectar la db falsa en la instancia por defecto que usa el coordinador.
    const { db } = fakeDb([grupoActivo]);
    Object.defineProperty(mongoose.connection, 'db', { value: db, configurable: true });
    const { getUsersForCausa } = require(path.join(__dirname, '..', 'services', 'judicialMovementCoordinator'));
    const fakeFolder = (rows) => ({ find: () => ({ select: () => ({ lean: async () => rows }) }) });

    // Carpeta de equipo cubierta: owner + 2 miembros entran.
    let stats = {};
    let r = await getUsersForCausa(fakeFolder([{ userId: OWNER, groupId: grupoActivo._id }]), 'c1', true, stats);
    assert.deepStrictEqual(r.sort(), esperados);
    assert.strictEqual(stats.destinatariosEquipo, 2);
    assert.strictEqual(stats.usuariosSinCobertura, undefined);

    // Carpeta de equipo SIN cobertura: nadie del equipo entra, los 3 se cuentan omitidos.
    stats = {};
    r = await getUsersForCausa(fakeFolder([{ userId: OWNER, groupId: grupoActivo._id, causaCredentialCovered: false }]), 'c1', true, stats);
    assert.deepStrictEqual(r, []);
    assert.strictEqual(stats.destinatariosEquipo, 2);
    assert.strictEqual(stats.usuariosSinCobertura, 3);

    // Miembro con carpeta propia cubierta de la misma causa → entra aunque la del equipo no cubra.
    stats = {};
    r = await getUsersForCausa(fakeFolder([
      { userId: OWNER, groupId: grupoActivo._id, causaCredentialCovered: false },
      { userId: M_ACTIVO_1, causaCredentialCovered: true }
    ]), 'c1', true, stats);
    assert.deepStrictEqual(r, [String(M_ACTIVO_1)]);
    assert.strictEqual(stats.usuariosSinCobertura, 2);

    // Carpeta sin groupId de un usuario sin equipo: solo él.
    stats = {};
    r = await getUsersForCausa(fakeFolder([{ userId: SIN_GRUPO }]), 'c1', true, stats);
    assert.deepStrictEqual(r, [String(SIN_GRUPO)]);
    assert.strictEqual(stats.destinatariosEquipo, undefined);

    // Carpeta sin groupId del OWNER de un equipo activo (anterior al equipo): owner + miembros.
    stats = {};
    r = await getUsersForCausa(fakeFolder([{ userId: OWNER }]), 'c1', true, stats);
    assert.deepStrictEqual(r.sort(), esperados);
    assert.strictEqual(stats.destinatariosEquipo, 2);
  });

  await test('7. buildTeamPairs: extras por owner|causa, carpeta y reservados con la cobertura de la carpeta', () => {
    const G = String(grupoActivo._id);
    const recipientsByGroup = new Map([[G, esperados]]);
    const teamFolders = [
      { userId: OWNER, causaId: 'c1', groupId: grupoActivo._id },                                  // cubierta
      { userId: OWNER, causaId: 'c2', groupId: grupoActivo._id, causaCredentialCovered: false },   // sin cobertura
      { userId: OWNER, causaId: 'c3', groupId: grupoActivo._id, causaCredentialCovered: false },
      { userId: OWNER, causaId: 'c3', groupId: grupoActivo._id, causaCredentialCovered: true },    // otra carpeta cubre c3
      { userId: OWNER, causaId: 'c4', groupId: oid() },                                           // grupo desconocido → nadie
      { userId: OWNER, causaId: null, groupId: grupoActivo._id },                                 // sin causa → se ignora
    ];
    const r = buildTeamPairs(teamFolders, recipientsByGroup);
    const miembros = [String(M_ACTIVO_1), String(M_ACTIVO_2)].sort();
    assert.deepStrictEqual([...r.extraRecipients.get(`${OWNER}|c1`)].sort(), miembros);
    assert.deepStrictEqual([...r.extraRecipients.get(`${OWNER}|c2`)].sort(), miembros);
    assert.strictEqual(r.extraRecipients.has(`${OWNER}|c4`), false);
    assert.deepStrictEqual(r.userIds.sort(), miembros);
    // Reservados: solo c2 (c3 tiene otra carpeta de equipo que la cubre, c1 está cubierta).
    assert.deepStrictEqual([...r.reservedPairs].sort(), [`${M_ACTIVO_1}|c2`, `${M_ACTIVO_2}|c2`].sort());
    // Con carpeta: c1, c2 y c3 para cada miembro.
    assert.strictEqual(r.folderPairs.size, 6);
    assert.ok(r.folderPairs.has(`${M_ACTIVO_1}|c3`));
    // Sin carpetas de equipo → todo vacío.
    const v = buildTeamPairs([], recipientsByGroup);
    assert.strictEqual(v.extraRecipients.size, 0);
    assert.deepStrictEqual(v.userIds, []);
  });

  await test('8. buildTaskRecipientFilter: asignados; sin asignados, quien la creó (o el dueño si no hay creador)', () => {
    const f = buildTaskRecipientFilter(String(OWNER));
    assert.ok(Array.isArray(f.$or) && f.$or.length === 3);
    assert.ok(f.$or[0].assignedTo instanceof mongoose.Types.ObjectId && f.$or[0].assignedTo.equals(OWNER));
    // Se combina por spread sin pisar el resto del filtro.
    const full = { ...f, status: { $nin: ['completada'] }, checked: false };
    assert.ok(full.$or && full.status && full.checked === false);
    // Semántica contra docs en memoria (mismo predicado que Mongo evaluaría).
    const sinAsignados = (t) => !t.assignedTo || t.assignedTo.length === 0;
    const match = (t, uid) => (t.assignedTo || []).some((a) => String(a) === uid)
      || (sinAsignados(t) && t.createdBy && String(t.createdBy) === uid)
      || (sinAsignados(t) && String(t.userId) === uid && (!t.createdBy || String(t.createdBy) === uid));
    const U = String(OWNER); const A = String(M_ACTIVO_1);
    assert.strictEqual(match({ userId: OWNER, assignedTo: [] }, U), true);
    assert.strictEqual(match({ userId: OWNER }, U), true);
    assert.strictEqual(match({ userId: OWNER, assignedTo: [M_ACTIVO_1] }, U), false);   // dueño con asignado → no
    assert.strictEqual(match({ userId: OWNER, assignedTo: [M_ACTIVO_1] }, A), true);    // asignado → sí
    assert.strictEqual(match({ userId: OWNER, assignedTo: [] }, A), false);
    assert.strictEqual(match({ userId: OWNER, createdBy: M_ACTIVO_1 }, A), true);       // creada por el miembro → él
    assert.strictEqual(match({ userId: OWNER, createdBy: M_ACTIVO_1 }, U), false);      // y no el owner
    // El filtro tiene las mismas tres ramas que el predicado.
    assert.ok(f.$or[1].$and.some((c) => c.createdBy && c.createdBy.equals(OWNER)));
    assert.ok(f.$or[2].$and.some((c) => c.userId && c.userId.equals(OWNER)));
    // El schema local de Task declara assignedTo (strictQuery descartaría el campo si no).
    const Task = require(path.join(__dirname, '..', 'models', 'Task'));
    const p = Task.schema.path('assignedTo');
    assert.ok(p, 'Task.assignedTo no está en el schema');
    assert.strictEqual(p.instance, 'Array');
    assert.deepStrictEqual(new Task({ name: 'x', userId: OWNER }).assignedTo.toObject(), []);
  });

  console.log(`\n${ok} ok, ${fail} fallidas`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
