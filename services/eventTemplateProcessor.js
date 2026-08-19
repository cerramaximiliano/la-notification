const moment = require('moment');
const { esc } = require('./htmlEscape');

// Pill chica estilo unificado (mismo lenguaje visual que el email de movimientos)
function pill(text, bg, color, border) {
  return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;background-color:${bg};color:${color};border:1px solid ${border};">${text}</span>`;
}

/**
 * Procesa datos de eventos del calendario para generar las variables del template.
 * Diseño unificado 2026-08: cards blancas sobre la superficie gris del shell
 * (mismo lenguaje que el email de movimientos judiciales).
 * @param {Array} events - Array de eventos próximos
 * @param {Object} user - Usuario destinatario
 * @param {Map} [folderMap] - folderId (string) → { folderName, archived }, para
 *   renderizar la carpeta vinculada y armar los deep-links. Opcional: sin el
 *   map, los eventos se renderizan como siempre.
 * @returns {Object} - Variables procesadas para el template
 */
function processEventsData(events, user, folderMap = new Map()) {
  const baseUrl = (process.env.BASE_URL || 'https://www.lawanalytics.app').replace(/\/$/, '');
  let eventsTableHtml = '';
  let eventsListText = '';

  events.forEach((event) => {
    const startDate = new Date(event.start);
    const day = startDate.getUTCDate().toString().padStart(2, '0');
    const month = (startDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = startDate.getUTCFullYear();
    const formattedDate = `${day}/${month}/${year}`;

    let timeDisplay = '';
    if (!event.allDay) {
      const hour = startDate.getUTCHours();
      const minute = startDate.getUTCMinutes().toString().padStart(2, '0');
      const ampm = hour >= 12 ? 'p. m.' : 'a. m.';
      const hour12 = (hour % 12) || 12;
      timeDisplay = ` ${hour12}:${minute} ${ampm}`;
    }

    const daysUntilEvent = moment(startDate).diff(moment().startOf('day'), 'days');
    let urgencyPill = '';
    if (daysUntilEvent === 0) {
      urgencyPill = ` ${pill('Hoy', '#FEF2F2', '#DC2626', '#FECACA')}`;
    } else if (daysUntilEvent === 1) {
      urgencyPill = ` ${pill('Mañana', '#FFF7ED', '#B45309', '#FDBA74')}`;
    }
    const allDayNote = event.allDay ? ` <span style="color:#94A3B8;">(todo el día)</span>` : '';

    // Contexto de carpeta y movimiento (si el evento está vinculado).
    // El deep-link ?movement=...&open=1 es el mismo que usa el botón
    // "Ir al movimiento" del calendario: resalta la fila y abre el visor.
    const folder = event.folderId ? folderMap.get(String(event.folderId)) : null;
    const folderUrl = event.folderId ? `${baseUrl}/apps/folders/details/${encodeURIComponent(event.folderId)}` : null;
    const movementUrl =
      event.folderId && event.movementRef ? `${folderUrl}?movement=${encodeURIComponent(event.movementRef)}&open=1` : null;

    let contextRowHtml = '';
    if (folder) {
      const folderPill = pill(esc(folder.folderName || 'Carpeta'), '#EFF4FF', '#3A7BFF', '#D6E4FF');
      const archivedPill = folder.archived ? ` ${pill('Archivada', '#FFF7ED', '#B45309', '#FDBA74')}` : '';
      const cta = movementUrl
        ? `<a href="${movementUrl}" style="font-size:12px;font-weight:600;color:#3A7BFF;text-decoration:none;white-space:nowrap;">Ver movimiento &rarr;</a>`
        : `<a href="${folderUrl}" style="font-size:12px;font-weight:600;color:#3A7BFF;text-decoration:none;white-space:nowrap;">Ver carpeta &rarr;</a>`;
      contextRowHtml = `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>
            <td>${folderPill}${archivedPill}</td>
            <td align="right">${cta}</td>
          </tr></table>`;
    }

    eventsTableHtml += `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E6EAF2;border-radius:8px;margin-bottom:10px;">
        <tr><td style="padding:12px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:13px;font-weight:600;color:#0F172A;">${esc(event.title)}${urgencyPill}</td>
            <td align="right" style="font-size:12px;color:#64748B;white-space:nowrap;">${formattedDate}${timeDisplay}${allDayNote}</td>
          </tr></table>
          ${event.description ? `<p style="margin:6px 0 0 0;font-size:13px;line-height:1.55;color:#475569;">${esc(event.description)}</p>` : ''}${contextRowHtml}
        </td></tr>
      </table>`;

    // Texto plano
    if (event.allDay) {
      eventsListText += `- ${formattedDate} (Todo el día)`;
    } else {
      eventsListText += `- ${formattedDate}${timeDisplay}`;
    }
    if (daysUntilEvent === 0) eventsListText += ' (HOY)';
    if (daysUntilEvent === 1) eventsListText += ' (MAÑANA)';
    eventsListText += `: ${event.title}\n`;
    if (event.description) {
      eventsListText += `  ${event.description}\n`;
    }
    if (folder) {
      eventsListText += `  Carpeta: ${folder.folderName || 'Carpeta'}${folder.archived ? ' (archivada)' : ''}\n`;
      eventsListText += `  ${movementUrl || folderUrl}\n`;
    }
  });

  return {
    userName: user.name || user.email || 'Usuario',
    userEmail: user.email,
    eventsCount: events.length,
    eventsTableHtml,
    eventsListText,
    'process.env.BASE_URL': process.env.BASE_URL || ''
  };
}

module.exports = {
  processEventsData
};
