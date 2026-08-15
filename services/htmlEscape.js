/**
 * Escapado de texto para los emails HTML.
 *
 * Todo dato que no sea markup nuestro tiene que pasar por acá antes de
 * interpolarse en un template: títulos y descripciones que escribe el usuario,
 * carátulas y detalles que vienen del scraping de los portales, nombres de
 * carpetas, etc.
 *
 * Sin esto, un `&` en un nombre ("Pérez & Asociados") genera una entidad HTML
 * inválida y un `<` puede romper el layout del correo o inyectar markup.
 */

/**
 * @param {*} value
 * @returns {string} texto seguro para interpolar en HTML
 */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { esc };
