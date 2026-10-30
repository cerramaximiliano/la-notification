/**
 * Reglas de avisos por carpeta del equipo (30/10/2026). Sin Mongo.
 *   node tests/test-folder-policy.js
 */
const assert = require('assert');
const path = require('path');
const mongoose = require('mongoose');
const { applyFolderPolicy, eventRecipients, contextFromGroupDoc, buildTeamPairs } = require(path.join(__dirname, '..', 'services', 'teamRecipients'));
const { keepEventsForRecipient, recipientSettings } = require(path.join(__dirname, '..', 'services', 'eventRecipients'));

const id = () => new mongoose.Types.ObjectId();
const O = id(); const A = id(); const B = id(); const C = id(); const X = id();
const S = (v) => String(v);
const grupo = (notifications) => contextFromGroupDoc({
  _id: id(), owner: O,
  members: [{ userId: A, status: 'active' }, { userId: B, status: 'active' }, { userId: C, status: 'removed' }],
  settings: { notifications }
});
const sorted = (a) => [...a].sort();

let ok = 0; let fail = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

(async () => {
  await test('1. sin configuración: todos los integrantes activos (como hasta ahora)', () => {
    assert.deepStrictEqual(sorted(applyFolderPolicy(grupo(undefined), {})), sorted([S(O), S(A), S(B)]));
  });
  await test('2. carpeta «responsables» con responsables: solo ellos (ignora removidos y extraños)', () => {
    const r = applyFolderPolicy(grupo({}), { notificationPolicy: 'responsables', responsables: [A, C, X] });
    assert.deepStrictEqual(r, [S(A)]);
  });
  await test('3. regla «responsables» sin responsables vigentes: todos', () => {
    const r = applyFolderPolicy(grupo({ defaultPolicy: 'responsables' }), { responsables: [C] });
    assert.deepStrictEqual(sorted(r), sorted([S(O), S(A), S(B)]));
  });
  await test('4. regla del equipo «responsables» y carpeta «equipo»: la del equipo; carpeta «todos» la pisa', () => {
    const ctx = grupo({ defaultPolicy: 'responsables' });
    assert.deepStrictEqual(applyFolderPolicy(ctx, { notificationPolicy: 'equipo', responsables: [B] }), [S(B)]);
    assert.deepStrictEqual(sorted(applyFolderPolicy(ctx, { notificationPolicy: 'todos', responsables: [B] })), sorted([S(O), S(A), S(B)]));
  });
  await test('5. modos por integrante: «todo» siempre, «solo_lo_mio» solo si es responsable', () => {
    const ctx = grupo({ defaultPolicy: 'todos', members: [{ userId: O, mode: 'todo' }, { userId: A, mode: 'solo_lo_mio' }] });
    assert.deepStrictEqual(sorted(applyFolderPolicy(ctx, { notificationPolicy: 'responsables', responsables: [B] })), sorted([S(O), S(B)]));
    assert.deepStrictEqual(sorted(applyFolderPolicy(ctx, { responsables: [] })), sorted([S(O), S(B)]));
    assert.deepStrictEqual(sorted(applyFolderPolicy(ctx, { responsables: [A] })), sorted([S(O), S(A), S(B)]));
  });
  await test('6. nunca vacío: si la regla deja a nadie, el owner', () => {
    const ctx = grupo({ members: [{ userId: O, mode: 'solo_lo_mio' }, { userId: A, mode: 'solo_lo_mio' }, { userId: B, mode: 'solo_lo_mio' }] });
    assert.deepStrictEqual(applyFolderPolicy(ctx, {}), [S(O)]);
  });
  await test('7. eventos: carpeta → responsables (sin responsables, todos); sin carpeta → todos; personal o viejo → su creador', () => {
    const ctx = grupo({});
    assert.deepStrictEqual(eventRecipients(ctx, { userId: O, createdBy: A }, { notificationPolicy: 'todos', responsables: [B] }), [S(B)], 'manda la carpeta aunque su regla sea «todos»');
    assert.deepStrictEqual(sorted(eventRecipients(ctx, { userId: O, createdBy: A }, { responsables: [] })), sorted([S(O), S(A), S(B)]));
    assert.deepStrictEqual(sorted(eventRecipients(ctx, { userId: O, createdBy: A }, null)), sorted([S(O), S(A), S(B)]));
    assert.deepStrictEqual(eventRecipients(ctx, { userId: O, createdBy: A, personal: true }, null), [S(A)]);
    assert.deepStrictEqual(eventRecipients(ctx, { userId: O }, null), [S(O)], 'sin creador ni carpeta: agenda previa del owner');
    assert.deepStrictEqual(eventRecipients(ctx, { userId: O, createdBy: C, personal: true }, null), [S(O)], 'creador fuera del equipo');
    assert.deepStrictEqual(eventRecipients(null, { userId: X }, null), [S(X)]);
  });
  await test('8. webhook: destinatarios por carpeta y owner excluido solo si lo excluyen todas sus carpetas', () => {
    const f1 = { _id: id(), userId: O, causaId: 'c1', groupId: id() };
    const f2 = { _id: id(), userId: O, causaId: 'c2', groupId: f1.groupId };
    const f3 = { _id: id(), userId: O, causaId: 'c2', groupId: f1.groupId };
    const map = new Map([[`f:${f1._id}`, [S(A)]], [`f:${f2._id}`, [S(B)]], [`f:${f3._id}`, [S(O), S(B)]]]);
    const r = buildTeamPairs([f1, f2, f3], map);
    assert.deepStrictEqual(r.extraRecipients.get(`${S(O)}|c1`), [S(A)]);
    assert.ok(r.excludedPairs.has(`${S(O)}|c1`));
    assert.ok(!r.excludedPairs.has(`${S(O)}|c2`), 'en c2 una carpeta lo incluye');
    assert.ok(r.folderPairs.has(`${S(A)}|c1`) && !r.folderPairs.has(`${S(B)}|c1`));
  });
  await test('9. buildTeamPairs sin claves por carpeta sigue como antes (sin exclusiones)', () => {
    const g = id();
    const r = buildTeamPairs([{ userId: O, causaId: 'c', groupId: g }], new Map([[S(g), [S(O), S(A)]]]));
    assert.deepStrictEqual(r.extraRecipients.get(`${S(O)}|c`), [S(A)]);
    assert.strictEqual(r.excludedPairs.size, 0);
  });
  await test('10. eventos de un destinatario: los de sus carpetas, los del equipo sin carpeta y sus personales', async () => {
    const ctx = grupo({});
    ctx.groupId = S(id());
    const folderResp = { _id: id(), userId: O, groupId: ctx.groupId, responsables: [B] };
    const folderSin = { _id: id(), userId: O };
    const evs = [
      { _id: 1, userId: O, createdBy: O, folderId: S(folderResp._id) },  // solo B
      { _id: 2, userId: O, createdBy: O, folderId: S(folderSin._id) },   // carpeta sin responsables → todos
      { _id: 3, userId: O, createdBy: A },                               // del equipo sin carpeta → todos
      { _id: 4, userId: O },                                             // agenda previa del owner → owner
      { _id: 5, userId: O, createdBy: A, personal: true },               // personal de A
      { _id: 6, userId: X }                                              // de otro usuario
    ];
    const load = async () => [folderResp, folderSin];
    const ids = async (u) => (await keepEventsForRecipient(evs, u, ctx, load)).map((e) => e._id);
    assert.deepStrictEqual(await ids(S(A)), [2, 3, 5]);
    assert.deepStrictEqual(await ids(S(B)), [1, 2, 3]);
    assert.deepStrictEqual(await ids(S(O)), [2, 3, 4]);
    assert.deepStrictEqual((await keepEventsForRecipient(evs, S(X), null, load)).length, 6, 'sin equipo no filtra (la consulta ya es por usuario)');
  });
  await test('11. configuración del evento: dueño la del evento, el resto la propia', () => {
    const ev = { userId: O, notificationSettings: { notifyOnceOnly: true, daysInAdvance: 2 } };
    assert.deepStrictEqual(recipientSettings(ev, S(O), { notifyOnceOnly: false, daysInAdvance: 7 }), { notifyOnceOnly: true, daysInAdvance: 2 });
    assert.deepStrictEqual(recipientSettings(ev, S(A), { notifyOnceOnly: false, daysInAdvance: 7 }), { notifyOnceOnly: false, daysInAdvance: 7 });
  });
  await test('12. visibilidad «solo lo suyo»: no recibe avisos de carpetas ajenas aunque la regla sea «todos»', () => {
    const ctx = contextFromGroupDoc({
      _id: id(), owner: O,
      members: [{ userId: A, status: 'active', role: 'editor' }, { userId: B, status: 'active', role: 'admin' }],
      settings: { notifications: { defaultPolicy: 'todos' }, visibility: { defaultMode: 'propio' } }
    });
    assert.deepStrictEqual(sorted(applyFolderPolicy(ctx, {})), sorted([S(O), S(B)]), 'A (editor, propio) afuera; B admin siempre');
    assert.deepStrictEqual(sorted(applyFolderPolicy(ctx, { responsables: [A] })), sorted([S(O), S(A), S(B)]));
    assert.deepStrictEqual(sorted(applyFolderPolicy(ctx, { createdBy: A })), sorted([S(O), S(A), S(B)]), 'la creó');
    const ctx2 = contextFromGroupDoc({
      _id: id(), owner: O, members: [{ userId: A, status: 'active', role: 'editor' }],
      settings: { visibility: { defaultMode: 'propio', members: [{ userId: A, mode: 'todo' }] } }
    });
    assert.deepStrictEqual(sorted(applyFolderPolicy(ctx2, {})), sorted([S(O), S(A)]), 'excepción «todo»');
  });
  console.log(`\n${ok} ok, ${fail} fallidas`);
  process.exit(fail ? 1 : 0);
})();
