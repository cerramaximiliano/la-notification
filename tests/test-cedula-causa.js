/**
 * Causa de una notificación de bandeja para buscar la carpeta (12/11/2026). Sin Mongo.
 *   node tests/test-cedula-causa.js
 */
const assert = require('assert');
const path = require('path');
const mongoose = require('mongoose');
const { _internals: { causaIdDeNotificacion } } = require(path.join(__dirname, '..', 'services', 'judicialCedulaCoordinator'));

let ok = 0; let fail = 0;
function test(name, fn) {
  try { fn(); ok++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
const oid = new mongoose.Types.ObjectId();

test('vinculada → causaId en string', () => assert.strictEqual(causaIdDeNotificacion({ vinculo: { estado: 'vinculada', causaId: oid } }), String(oid)));
test('sin_movimiento con causa → causaId', () => assert.strictEqual(causaIdDeNotificacion({ vinculo: { estado: 'sin_movimiento', causaId: String(oid) } }), String(oid)));
test('sin vínculo → null (no se usa expediente.id del portal)', () => assert.strictEqual(causaIdDeNotificacion({ expediente: { id: 31118348 } }), null));
test('vinculo sin causa o inválido → null', () => {
  assert.strictEqual(causaIdDeNotificacion({ vinculo: { estado: 'sin_causa' } }), null);
  assert.strictEqual(causaIdDeNotificacion({ vinculo: { causaId: '31118348' } }), null);
  assert.strictEqual(causaIdDeNotificacion(null), null);
});

console.log(`\n${ok} ok, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
