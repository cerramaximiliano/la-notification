/**
 * Papelera de carpetas (2/11/2026, la-ads/docs/producto/equipos-papelera-y-resync.md).
 *
 * El hub marca con `deletedAt` las carpetas PJN y SCBA que el usuario elimina: siguen vinculadas a su causa y
 * los workers las siguen actualizando, pero para este servicio rige una regla única: **una carpeta en la
 * papelera no es destinataria de nada** (ni movimientos, ni cédulas, ni recordatorios de sus tareas y eventos).
 */

/** Filtro para consultas de carpetas: solo las que no están en la papelera. */
const NOT_TRASHED = Object.freeze({ deletedAt: null });

/** @param {{deletedAt?: Date|null}|null|undefined} folder */
const isTrashed = (folder) => !!(folder && folder.deletedAt);

/**
 * Quita de la lista los ítems (tareas, eventos) cuya carpeta está en la papelera. Los que no tienen
 * carpeta, o cuya carpeta no está en la papelera, quedan.
 * @param {Array<{folderId?: any}>} items
 * @param {{find: Function}} Folder modelo Mongoose (o uno con la misma firma, para tests)
 */
async function dropItemsOfTrashedFolders(items, Folder) {
  const list = Array.isArray(items) ? items : [];
  const folderIds = [...new Set(list.map((it) => it && it.folderId).filter(Boolean).map(String))];
  if (!folderIds.length) return list;
  let trashed;
  try {
    const docs = await Folder.find({ _id: { $in: folderIds }, deletedAt: { $ne: null } }).select('_id').lean();
    trashed = new Set(docs.map((d) => String(d._id)));
  } catch (_) {
    return list; // ante un error de lectura no se pierde ningún aviso
  }
  if (!trashed.size) return list;
  return list.filter((it) => !(it && it.folderId && trashed.has(String(it.folderId))));
}

module.exports = { NOT_TRASHED, isTrashed, dropItemsOfTrashedFolders };
