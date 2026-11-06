// Seguimiento (6/11/2026): en el correo de movimientos, las carpetas marcadas van primero y con chip.
// Uso: node tests/test-seguimiento-correo.js
const assert = require('assert');
const { processJudicialMovementsData } = require('../services/templateProcessor');
const mov = (id, fecha) => ({ _id: id, movimiento: { fecha, tipo: 'PROVEÍDO', detalle: 'Téngase presente' } });
const data = {
  'A|1': { expediente: { id: 'cA', number: '1', year: '2020', fuero: 'CSS', caratula: 'A c/ ANSES' }, movements: [mov('m1', '2026-11-05')] },
  'B|2': { expediente: { id: 'cB', number: '2', year: '2021', fuero: 'CSS', caratula: 'B c/ ANSES' }, movements: [mov('m2', '2026-11-06')] },
};
const out = processJudicialMovementsData(data, { email: 'x@x.com' }, {
  folderInfoByExpediente: { 'A|1': { archived: false }, 'B|2': { archived: false, seguimiento: true } },
});
const html = out.expedientesHtml;
assert(html.indexOf('B c/ ANSES') < html.indexOf('A c/ ANSES'), 'la carpeta en seguimiento va primero');
assert(html.includes('En seguimiento'), 'chip En seguimiento');
assert.strictEqual((html.match(/En seguimiento/g) || []).length, 1, 'solo una tiene el chip');
assert(out.expedientesText.includes('[EN SEGUIMIENTO]'), 'texto plano con la marca');
const sin = processJudicialMovementsData(data, { email: 'x@x.com' }, { folderInfoByExpediente: { 'A|1': { archived: false }, 'B|2': { archived: true } } });
assert(sin.expedientesHtml.indexOf('A c/ ANSES') < sin.expedientesHtml.indexOf('B c/ ANSES'), 'sin seguimiento conserva el orden');
assert(!sin.expedientesHtml.includes('En seguimiento'));
console.log('OK seguimiento en el correo: orden, chip y texto');
