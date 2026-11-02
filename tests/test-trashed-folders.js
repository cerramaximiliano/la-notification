/**
 * Papelera de carpetas (services/trashedFolders.js, 2/11/2026): una carpeta con deletedAt no es destinataria de nada.
 *   node tests/test-trashed-folders.js
 */
const assert = require('assert');
const path = require('path');
const { NOT_TRASHED, isTrashed, dropItemsOfTrashedFolders } = require(path.join(__dirname, '..', 'services', 'trashedFolders'));

let n = 0; const t = (nombre, fn) => Promise.resolve(fn()).then(() => { n++; console.log('OK', nombre); });
const fakeFolder = (trashedIds) => ({ find: () => ({ select: () => ({ lean: async () => trashedIds.map((id) => ({ _id: id })) }) }) });

(async () => {
  await t('NOT_TRASHED e isTrashed', () => {
    assert.deepStrictEqual(NOT_TRASHED, { deletedAt: null });
    assert.strictEqual(isTrashed({ deletedAt: new Date() }), true);
    assert.strictEqual(isTrashed({ deletedAt: null }), false);
    assert.strictEqual(isTrashed(null), false);
  });
  await t('quita tareas/eventos de carpetas en la papelera y deja el resto', async () => {
    const items = [{ _id: 1, folderId: 'A' }, { _id: 2, folderId: 'B' }, { _id: 3 }, { _id: 4, folderId: 'A' }];
    const r = await dropItemsOfTrashedFolders(items, fakeFolder(['A']));
    assert.deepStrictEqual(r.map((i) => i._id), [2, 3]);
  });
  await t('sin carpetas en la papelera no toca la lista', async () => {
    const items = [{ _id: 1, folderId: 'A' }];
    assert.strictEqual(await dropItemsOfTrashedFolders(items, fakeFolder([])), items);
  });
  await t('si la lectura falla, no se pierde ningún aviso', async () => {
    const items = [{ _id: 1, folderId: 'A' }];
    const roto = { find: () => { throw new Error('x'); } };
    assert.strictEqual(await dropItemsOfTrashedFolders(items, roto), items);
  });
  console.log(`${n} ok`);
})().catch((e) => { console.error(e); process.exit(1); });
