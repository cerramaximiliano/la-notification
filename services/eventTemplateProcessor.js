const moment = require('moment');

/**
 * Procesa datos de eventos del calendario para generar las variables del template
 * @param {Array} events - Array de eventos próximos
 * @param {Object} user - Usuario destinatario
 * @returns {Object} - Variables procesadas para el template
 */
function processEventsData(events, user) {
  // Generar tabla HTML
  let eventsTableHtml = `
    <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
      <thead>
        <tr style="background-color: #e0e7ff;">
          <th style="border: 1px solid #c7d2fe; padding: 12px; text-align: left; font-weight: 600; color: #312e81;">Fecha</th>
          <th style="border: 1px solid #c7d2fe; padding: 12px; text-align: left; font-weight: 600; color: #312e81;">Título</th>
          <th style="border: 1px solid #c7d2fe; padding: 12px; text-align: left; font-weight: 600; color: #312e81;">Descripción</th>
        </tr>
      </thead>
      <tbody>`;

  // Generar texto plano
  let eventsListText = '';

  // Procesar cada evento
  events.forEach((event, index) => {
    // Extraer directamente los componentes de la fecha guardada
    const startDate = new Date(event.start);
    
    // Formato de fecha: DD/MM/YYYY
    const day = startDate.getUTCDate().toString().padStart(2, '0');
    const month = (startDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = startDate.getUTCFullYear();
    const formattedDate = `${day}/${month}/${year}`;
    
    // Formato de hora si no es evento de todo el día
    let dateTimeDisplay = formattedDate;
    if (!event.allDay) {
      const hour = startDate.getUTCHours();
      const minute = startDate.getUTCMinutes().toString().padStart(2, '0');
      const ampm = hour >= 12 ? 'p. m.' : 'a. m.';
      const hour12 = (hour % 12) || 12;
      const formattedTime = `${hour12}:${minute} ${ampm}`;
      dateTimeDisplay = `${formattedDate} ${formattedTime}`;
    } else {
      dateTimeDisplay = `${formattedDate} <span style="color: #6366f1; font-style: italic;">(Todo el día)</span>`;
    }
    
    // Determinar el estilo de la fila según proximidad
    const daysUntilEvent = moment(startDate).diff(moment().startOf('day'), 'days');
    let rowStyle = '';
    let urgencyIcon = '';
    
    if (daysUntilEvent === 0) {
      rowStyle = 'background-color: #e0e7ff;'; // Púrpura claro para hoy
      urgencyIcon = ' <strong style="color: #4338ca;">⚡ HOY</strong>';
    } else if (daysUntilEvent === 1) {
      rowStyle = 'background-color: #ede9fe;'; // Púrpura muy claro para mañana
      urgencyIcon = ' <strong style="color: #6366f1;">→ MAÑANA</strong>';
    }

    // Agregar fila a la tabla HTML
    eventsTableHtml += `
      <tr${rowStyle ? ` style="${rowStyle}"` : ''}>
        <td style="border: 1px solid #c7d2fe; padding: 12px; color: #1e1b4b;">
          ${dateTimeDisplay}${urgencyIcon}
        </td>
        <td style="border: 1px solid #c7d2fe; padding: 12px; color: #1e1b4b; font-weight: 500;">${event.title}</td>
        <td style="border: 1px solid #c7d2fe; padding: 12px; color: #1e1b4b;">${event.description || '-'}</td>
      </tr>`;

    // Agregar al texto plano
    if (event.allDay) {
      eventsListText += `- ${formattedDate} (Todo el día)`;
    } else {
      const hour = startDate.getUTCHours();
      const minute = startDate.getUTCMinutes().toString().padStart(2, '0');
      const ampm = hour >= 12 ? 'p. m.' : 'a. m.';
      const hour12 = (hour % 12) || 12;
      const formattedTime = `${hour12}:${minute} ${ampm}`;
      eventsListText += `- ${formattedDate} ${formattedTime}`;
    }
    
    if (daysUntilEvent === 0) eventsListText += ' (HOY)';
    if (daysUntilEvent === 1) eventsListText += ' (MAÑANA)';
    eventsListText += `: ${event.title}\n`;
    
    if (event.description) {
      eventsListText += `  ${event.description}\n`;
    }
  });

  eventsTableHtml += `
      </tbody>
    </table>`;

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