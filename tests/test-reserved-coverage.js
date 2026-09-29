/**
 * Causas reservadas sin cobertura de credencial (2026-09-28) — sin DB.
 *
 *  A. judicialMovementCoordinator.getUsersForCausa: solo devuelve los usuarios con
 *     al menos una carpeta de la causa que NO tenga causaCredentialCovered:false
 *     (pública sin campo, o privada cubierta); los que solo tienen carpetas sin
 *     cobertura se omiten y se cuentan en stats.usuariosSinCobertura.
 *  B. Predicado del webhook (routes/judicialMovements.js): un JudicialMovement
 *     'skipped' con motivo 'Causa reservada…' NO se resucita a pending; otros
 *     motivos y otros estados sí se resetean.
 *  C. Clave usuario|causa del pre-filtro del webhook: coincide entre el lean de
 *     Folder (ObjectId) y el payload (strings).
 *  D. El schema local de Folder declara causaCredentialCovered / causaIsPrivate.
 *
 * Uso: node tests/test-reserved-coverage.js
 */
process.env.NODE_ENV = 'test';
const assert = require('assert');
const path = require('path');
const mongoose = require('mongoose');
const { getUsersForCausa } = require(path.join(__dirname, '..', 'services', 'judicialMovementCoordinator'));
const JudicialMovement = require(path.join(__dirname, '..', 'models', 'JudicialMovement'));
const Folder = require(path.join(__dirname, '..', 'models', 'Folder'));

let ok = 0;
const test = (titulo, fn) => Promise.resolve().then(fn).then(() => { ok++; console.log(`  ✓ ${titulo}`); });

function fakeFolder(rows) {
  return { find: (q) => ({ select: () => ({ lean: async () => rows.filter((r) => (q.archived ? r.archived !== true : true)) }) }) };
}

(async () => {
  const rows = [
    { userId: 'u1' },                                 // pública (sin campo)
    { userId: 'u2', causaCredentialCovered: true },   // privada cubierta
    { userId: 'u3', causaCredentialCovered: false },  // credencial caída
    { userId: 'u4', causaCredentialCovered: false },  // nunca tuvo link
    { userId: 'u5', causaCredentialCovered: false, archived: true },
    { userId: null },
  ];

  await test('A. coordinador: solo usuarios con alguna carpeta cubierta/pública; omitidos contados', async () => {
    const stats = {};
    const r = await getUsersForCausa(fakeFolder(rows), 'c1', true, stats);
    assert.deepStrictEqual(r.sort(), ['u1', 'u2']);
    assert.strictEqual(stats.usuariosSinCobertura, 3);
  });
  await test('A. coordinador: includeArchived=false no cuenta la archivada como omitida', async () => {
    const stats = {};
    const r = await getUsersForCausa(fakeFolder(rows), 'c1', false, stats);
    assert.deepStrictEqual(r.sort(), ['u1', 'u2']);
    assert.strictEqual(stats.usuariosSinCobertura, 2);
  });
  await test('A. coordinador: sin stats no explota; sin carpetas → []', async () => {
    assert.deepStrictEqual((await getUsersForCausa(fakeFolder(rows), 'c1')).sort(), ['u1', 'u2']);
    assert.deepStrictEqual(await getUsersForCausa(fakeFolder([]), 'c1', true, {}), []);
  });
  await test('A. coordinador: usuario con una carpeta sin cobertura y otra cubierta de la misma causa → entra', async () => {
    const r = await getUsersForCausa(fakeFolder([{ userId: 'u9', causaCredentialCovered: false }, { userId: 'u9', causaCredentialCovered: true }]), 'c1', true, {});
    assert.deepStrictEqual(r, ['u9']);
  });

  // Mismo predicado que routes/judicialMovements.js (copiado a propósito: el test
  // documenta el contrato del motivo 'Causa reservada…').
  const pred = (m) => m.notificationStatus === 'skipped'
    && Array.isArray(m.notifications)
    && m.notifications.some((n) => typeof n?.details === 'string' && n.details.startsWith('Causa reservada'));
  const mk = (status, details) => {
    const doc = new JudicialMovement({
      userId: new mongoose.Types.ObjectId(), expediente: { id: 'x' },
      movimiento: { fecha: new Date(), tipo: 'T', detalle: 'd' },
      notificationSettings: { notifyAt: new Date() }, uniqueKey: 'k', notificationStatus: status,
    });
    doc.notifications.push({ date: new Date(), type: 'system', success: false, details });
    return doc;
  };
  await test('B. webhook: skipped por causa reservada → no se resucita (DocumentArray real)', () => {
    assert.strictEqual(pred(mk('skipped', 'Causa reservada: credencial sin cobertura')), true);
  });
  await test('B. webhook: skipped por otro motivo → se resetea', () => {
    assert.strictEqual(pred(mk('skipped', 'Descartado por política: folder archivado (notifyArchivedFolders=false)')), false);
  });
  await test('B. webhook: failed con motivo reservada → se resetea (solo skipped cuenta)', () => {
    assert.strictEqual(pred(mk('failed', 'Causa reservada: credencial sin cobertura')), false);
  });

  await test('C. webhook: la clave usuario|causa coincide entre Folder lean (ObjectId) y payload (string)', () => {
    const uid = new mongoose.Types.ObjectId();
    const cid = new mongoose.Types.ObjectId();
    const reservedPairs = new Set([{ userId: uid, causaId: cid }].map((f) => `${f.userId}|${f.causaId}`));
    assert.strictEqual(reservedPairs.has(`${String(uid)}|${String(cid)}`), true);
    assert.strictEqual(reservedPairs.has(`${String(uid)}|${String(new mongoose.Types.ObjectId())}`), false);
  });

  await test('D. schema local de Folder declara y castea causaCredentialCovered / causaIsPrivate', () => {
    const f = new Folder({ userId: new mongoose.Types.ObjectId(), folderName: 'x', causaCredentialCovered: false, causaIsPrivate: true });
    assert.strictEqual(f.causaCredentialCovered, false);
    assert.strictEqual(f.causaIsPrivate, true);
    assert.strictEqual(Folder.schema.path('causaCredentialCovered').instance, 'Boolean');
  });

  console.log(`test-reserved-coverage: ${ok} OK`);
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
