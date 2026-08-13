const moment = require('moment');

// Pill chica estilo unificado (mismo lenguaje visual que el email de movimientos)
function pill(text, bg, color, border) {
  return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;background-color:${bg};color:${color};border:1px solid ${border};">${text}</span>`;
}

/**
 * Procesa datos de tareas para generar las variables del template.
 * Diseño unificado 2026-08: cards blancas sobre la superficie gris del shell.
 * @param {Array} tasks - Array de tareas próximas a vencer
 * @param {Object} user - Usuario destinatario
 * @returns {Object} - Variables procesadas para el template
 */
function processTasksData(tasks, user) {
  const priorityPill = (priority) => {
    switch (priority) {
      case 'alta': return pill('Prioridad alta', '#FEF2F2', '#DC2626', '#FECACA');
      case 'media': return pill('Prioridad media', '#FFF7ED', '#B45309', '#FDBA74');
      case 'baja': return pill('Prioridad baja', '#ECFDF5', '#059669', '#6EE7B7');
      default: return '';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'pendiente': return 'Pendiente';
      case 'en_progreso': return 'En progreso';
      case 'revision': return 'En revisión';
      case 'completada': return 'Completada';
      case 'cancelada': return 'Cancelada';
      default: return status;
    }
  };

  let tasksTableHtml = '';
  let tasksListText = '';

  tasks.forEach(task => {
    const dueDate = new Date(task.dueDate);
    const day = dueDate.getUTCDate().toString().padStart(2, '0');
    const month = (dueDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = dueDate.getUTCFullYear();
    const formattedDate = `${day}/${month}/${year}`;

    let formattedTime = '';
    if (task.dueTime) {
      const [hours, minutes] = task.dueTime.split(':');
      const hour12 = (parseInt(hours) % 12) || 12;
      const ampm = parseInt(hours) >= 12 ? 'p. m.' : 'a. m.';
      formattedTime = `${hour12}:${minutes} ${ampm}`;
    } else {
      const hour = dueDate.getUTCHours().toString().padStart(2, '0');
      const minute = dueDate.getUTCMinutes().toString().padStart(2, '0');
      const ampm = parseInt(hour) >= 12 ? 'p. m.' : 'a. m.';
      const hour12 = (parseInt(hour) % 12) || 12;
      formattedTime = `${hour12}:${minute} ${ampm}`;
    }

    const statusText = getStatusText(task.status);

    tasksTableHtml += `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E6EAF2;border-radius:8px;margin-bottom:10px;">
        <tr><td style="padding:12px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:13px;font-weight:600;color:#0F172A;">${task.name}</td>
            <td align="right" style="font-size:12px;color:#64748B;white-space:nowrap;">Vence ${formattedDate}</td>
          </tr></table>
          ${task.description ? `<p style="margin:6px 0 0 0;font-size:13px;line-height:1.55;color:#475569;">${task.description}</p>` : ''}
          <p style="margin:8px 0 0 0;">${priorityPill(task.priority)} ${pill(statusText, '#EFF4FF', '#3A7BFF', '#C7D8FF')}</p>
        </td></tr>
      </table>`;

    tasksListText += `- ${formattedDate} ${formattedTime}: ${task.name} (Prioridad: ${task.priority.toUpperCase()}, Estado: ${statusText})\n`;
    if (task.description) {
      tasksListText += `  ${task.description}\n`;
    }
  });

  return {
    userName: user.name || user.email || 'Usuario',
    userEmail: user.email,
    tasksCount: tasks.length,
    tasksTableHtml,
    tasksListText,
    'process.env.BASE_URL': process.env.BASE_URL || ''
  };
}

module.exports = {
  processTasksData
};
