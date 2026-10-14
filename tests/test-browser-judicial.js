/**
 * Alertas in-app de movimientos judiciales (browser.js sendJudicialMovementBrowserAlerts) — sin DB.
 *
 *  A. Con movementIds la consulta va por _id (el caller ya marcó 'sent'); sin ellos, por 'pending'.
 *  B. La alerta creada pasa el schema REAL de models/Alert (sourceType 'movement',
 *     avatarIcon 'TableDocument'); antes fallaba con ValidationError (judicial_movement / Gavel).
 *  C. folderId resuelto por (userId, causaId) prefiriendo la no archivada; primaryText explícito.
 *  D. Movimiento ya notificado hoy por browser → se omite. Sin Folder en models → sin folderId.
 *  E. Una alerta por causa: N movimientos de la misma carátula → 1 aviso que apunta al más reciente.
 *  F. Una alerta por causa y por DÍA ARGENTINO: si la causa ya tuvo aviso hoy (otra tanda), no sale otro.
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

function build({ movements, folders = [], withFolder = true, avisadasHoy = [] }) {
  const state = { queries: [], created: [], distinct: [] };
  const models = {
    User: { findById: async () => user },
    JudicialMovement: {
      find: (q) => { state.queries.push(q); return { sort: async () => movements }; },
      distinct: async (field, q) => { state.distinct.push(q); return avisadasHoy; },
    },
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
    assert.strictEqual(a.actionText, 'Ver movimientos');
  });
  await test('C. folderId = carpeta no archivada del usuario para la causa; primaryText/secondaryText', async () => {
    const m = mov();
    const fArch = { _id: new mongoose.Types.ObjectId(), userId, causaId, archived: true };
    const fLive = { _id: new mongoose.Types.ObjectId(), userId, causaId };
    const { state, run } = build({ movements: [m], folders: [fArch, fLive] });
    await run({ movementIds: [m._id] });
    assert.strictEqual(String(state.created[0].folderId), String(fLive._id));
    assert.strictEqual(state.created[0].primaryText, 'Nuevo movimiento');
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
  await test('E. 3 movimientos de una causa + 1 de otra → 2 alertas, una por causa', async () => {
    const otraCausa = new mongoose.Types.ObjectId().toString();
    const a1 = mov({ movimiento: { fecha: new Date('2026-10-10T00:00:00Z'), tipo: 'DESPACHO', detalle: 'x' } });
    const a2 = mov({ movimiento: { fecha: new Date('2026-10-12T00:00:00Z'), tipo: 'ESCRITO INCORPORADO', detalle: 'x' } });
    const a3 = mov({ movimiento: { fecha: new Date('2026-10-13T00:00:00Z'), tipo: 'CEDULA', detalle: 'x' } });
    const b1 = mov({ expediente: { id: otraCausa, fuero: 'CIV', caratula: 'LÓPEZ c/ RUIZ s/COBRO' } });
    // find() devuelve ordenado por fecha ascendente, como la consulta real
    const { state, run } = build({ movements: [b1, a1, a2, a3] });
    const r = await run({ movementIds: [a1._id, a2._id, a3._id, b1._id] });
    assert.strictEqual(state.created.length, 2);
    assert.strictEqual(r.count, 4);
    assert.strictEqual(r.alertsCount, 2);
    assert.strictEqual(r.movementIds.length, 4);
    const agrupada = state.created.find((x) => x.secondaryText.startsWith('PÉREZ'));
    assert.strictEqual(agrupada.primaryText, 'Nuevos movimientos');
    assert.strictEqual(agrupada.secondaryText, 'PÉREZ c/ GÓMEZ s/DAÑOS · 13/10/2026');
    assert.strictEqual(agrupada.actionText, 'Ver movimientos');
    assert.strictEqual(String(agrupada.sourceId), String(a3._id));
    const suelta = state.created.find((x) => x.secondaryText.startsWith('LÓPEZ'));
    assert.strictEqual(suelta.primaryText, 'Nuevo movimiento');
    assert.ok(!/DESPACHO/.test(suelta.primaryText + suelta.secondaryText));
  });
  await test('E. sin expediente.id cada movimiento va solo', async () => {
    const m1 = mov({ expediente: { caratula: 'SIN ID 1' } }); const m2 = mov({ expediente: { caratula: 'SIN ID 2' } });
    const { state, run } = build({ movements: [m1, m2] });
    await run({ movementIds: [m1._id, m2._id] });
    assert.strictEqual(state.created.length, 2);
  });
  await test('F. causa ya avisada hoy en otra tanda → sin alerta nueva; la otra causa sí sale', async () => {
    const otraCausa = new mongoose.Types.ObjectId().toString();
    const a = mov(); const b = mov({ expediente: { id: otraCausa, fuero: 'CIV', caratula: 'LÓPEZ c/ RUIZ s/COBRO' } });
    const { state, run } = build({ movements: [a, b], avisadasHoy: [causaId] });
    const r = await run({ movementIds: [a._id, b._id] });
    assert.strictEqual(state.created.length, 1);
    assert.ok(state.created[0].secondaryText.startsWith('LÓPEZ'));
    assert.strictEqual(r.count, 1);
    // la consulta busca avisos de browser desde el inicio del día argentino
    const q = state.distinct[0];
    assert.deepStrictEqual(q['expediente.id'].$in.sort(), [causaId, otraCausa].sort());
    assert.strictEqual(q.notifications.$elemMatch.type, 'browser');
    const inicio = q.notifications.$elemMatch.date.$gte;
    assert.strictEqual(moment(inicio).utcOffset(-180).format('HH:mm'), '00:00');
  });
  await test('F. única causa ya avisada hoy → notified false, sin alertas', async () => {
    const m = mov(); const { state, run } = build({ movements: [m], avisadasHoy: [causaId] });
    const r = await run({ movementIds: [m._id] });
    assert.strictEqual(r.notified, false); assert.strictEqual(state.created.length, 0);
  });
  await test('F. aviso de browser de AYER en hora argentina (hoy en UTC) no bloquea', async () => {
    // 23:30 ART de ayer = 02:30 UTC de hoy: con corte UTC contaba como "hoy".
    const ayerArt = moment().utcOffset(-180).startOf('day').subtract(30, 'minutes').toDate();
    const m = mov({ notifications: [{ date: ayerArt, type: 'browser', success: true }] });
    const { state, run } = build({ movements: [m] });
    await run({ movementIds: [m._id] });
    assert.strictEqual(state.created.length, 1);
  });
  await test('F. si distinct falla, se avisa igual (mejor repetido que perdido)', async () => {
    const m = mov(); const { state, run } = build({ movements: [m] });
    const models = { User: { findById: async () => user }, JudicialMovement: { find: () => ({ sort: async () => [m] }), distinct: async () => { throw new Error('boom'); } }, Alert: { create: async (d) => { state.created.push(d); return d; } } };
    await sendJudicialMovementBrowserAlerts({ userId, models, utilities: { logger, mongoose, moment }, movementIds: [m._id] });
    assert.strictEqual(state.created.length, 1);
  });
  console.log(`test-browser-judicial: ${ok} OK`); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
