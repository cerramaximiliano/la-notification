/**
 * Alertas in-app de movimientos judiciales (browser.js sendJudicialMovementBrowserAlerts) — sin DB.
 *
 *  A. Con movementIds la consulta va por _id (el caller ya marcó 'sent'); sin ellos, por 'pending'.
 *  B. La alerta creada pasa el schema REAL de models/Alert (sourceType 'movement',
 *     avatarIcon 'TableDocument'); antes fallaba con ValidationError (judicial_movement / Gavel).
 *  C. folderId resuelto por (userId, causaId) prefiriendo la no archivada; primaryText explícito.
 *  D. Movimiento ya notificado hoy por browser → se omite. Sin Folder en models → sin folderId.
 *
 * Uso: node tests/test-browser-judicial.js
 */
process.env.NODE_ENV = 'test';
const assert = require('assert');
const path = require('path');
const mongoose = require('mongoose');
const moment = require('moment');
const RealAlert = require(path.join(__dirname, '..', 'models', 'Alert'));
const { sendJudicialMovementBrowserAlerts } = require(path.join(__dirname, '..', 'services', 'browser'));

const logger = { info() {}, warn() {}, error(...a) { console.error('LOGGER.ERROR', ...a); } };
const userId = new mongoose.Types.ObjectId();
const causaId = new mongoose.Types.ObjectId().toString();
const user = { _id: userId, preferences: { notifications: { channels: { browser: true }, user: { expiration: true } } } };
const mov = (over = {}) => ({
  _id: new mongoose.Types.ObjectId(), userId,
  expediente: { id: causaId, fuero: 'CIV', caratula: 'PÉREZ c/ GÓMEZ s/DAÑOS' },
  movimiento: { fecha: new Date('2026-09-25T00:00:00Z'), tipo: 'DESPACHO', detalle: 'x' },
  notifications: [], ...over,
});

function build({ movements, folders = [], withFolder = true }) {
  const state = { queries: [], created: [] };
  const models = {
    User: { findById: async () => user },
    JudicialMovement: { find: (q) => { state.queries.push(q); return { sort: async () => movements }; } },
    Alert: { create: async (d) => { const doc = new RealAlert(d); const err = doc.validateSync(); if (err) throw err; state.created.push(doc); return doc; } },
  };
  if (withFolder) models.Folder = { find: (q) => ({ lean: async () => folders.filter((f) => String(f.userId) === String(q.userId) && f.causaId === q.causaId) }) };
  return { state, run: (extra = {}) => sendJudicialMovementBrowserAlerts({ userId, models, utilities: { logger, mongoose, moment }, ...extra }) };
}

let ok = 0;
const test = (t, fn) => Promise.resolve().then(fn).then(() => { ok++; console.log(`  ✓ ${t}`); });

(async () => {
  await test('A. con movementIds → query por _id $in, sin filtro de status', async () => {
    const m = mov(); const { state, run } = build({ movements: [m] });
    const r = await run({ movementIds: [m._id] });
    assert.strictEqual(r.success && r.notified, true);
    assert.deepStrictEqual(state.queries[0]._id, { $in: [m._id] });
    assert.strictEqual(state.queries[0].notificationStatus, undefined);
  });
  await test('A. sin movementIds → query por notificationStatus pending (legacy)', async () => {
    const { state, run } = build({ movements: [] });
    await run();
    assert.strictEqual(state.queries[0].notificationStatus, 'pending');
    assert.strictEqual(state.queries[0]._id, undefined);
  });
  await test('B. la alerta valida contra el schema real: sourceType movement + TableDocument', async () => {
    const m = mov(); const { state, run } = build({ movements: [m] });
    const r = await run({ movementIds: [m._id] });
    assert.strictEqual(r.count, 1);
    const a = state.created[0];
    assert.strictEqual(a.sourceType, 'movement');
    assert.strictEqual(a.avatarIcon, 'TableDocument');
    assert.strictEqual(String(a.sourceId), String(m._id));
    assert.strictEqual(a.actionText, 'Ver movimiento');
  });
  await test('C. folderId = carpeta no archivada del usuario para la causa; primaryText/secondaryText', async () => {
    const m = mov();
    const fArch = { _id: new mongoose.Types.ObjectId(), userId, causaId, archived: true };
    const fLive = { _id: new mongoose.Types.ObjectId(), userId, causaId };
    const { state, run } = build({ movements: [m], folders: [fArch, fLive] });
    await run({ movementIds: [m._id] });
    assert.strictEqual(String(state.created[0].folderId), String(fLive._id));
    assert.strictEqual(state.created[0].primaryText, 'Nuevo movimiento: DESPACHO');
    assert.strictEqual(state.created[0].secondaryText, 'PÉREZ c/ GÓMEZ s/DAÑOS · 25/09/2026');
  });
  await test('C. solo archivada → se usa igual; sin carpeta → folderId ausente', async () => {
    const m1 = mov(); const fArch = { _id: new mongoose.Types.ObjectId(), userId, causaId, archived: true };
    const b1 = build({ movements: [m1], folders: [fArch] }); await b1.run({ movementIds: [m1._id] });
    assert.strictEqual(String(b1.state.created[0].folderId), String(fArch._id));
    const m2 = mov(); const b2 = build({ movements: [m2] }); await b2.run({ movementIds: [m2._id] });
    assert.strictEqual(b2.state.created[0].folderId, undefined);
  });
  await test('D. ya notificado hoy por browser → omitido; sin models.Folder no explota', async () => {
    const m = mov({ notifications: [{ date: new Date(), type: 'browser', success: true, details: 'x' }] });
    const { state, run } = build({ movements: [m], withFolder: false });
    const r = await run({ movementIds: [m._id] });
    assert.strictEqual(r.notified, false); assert.strictEqual(state.created.length, 0);
    const m2 = mov(); const b = build({ movements: [m2], withFolder: false }); await b.run({ movementIds: [m2._id] });
    assert.strictEqual(b.state.created.length, 1);
  });
  console.log(`test-browser-judicial: ${ok} OK`); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
