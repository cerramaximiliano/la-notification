const moment = require('moment');

/**
 * Procesa datos de tareas para generar las variables del template
 * @param {Array} tasks - Array de tareas próximas a vencer
 * @param {Object} user - Usuario destinatario
 * @returns {Object} - Variables procesadas para el template
 */
function processTasksData(tasks, user) {
  // Función para mapear la prioridad a colores en HTML
  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'alta': return 'background-color: #ffdddd; color: #d32f2f;';
      case 'media': return 'background-color: #fff9c4; color: #f57f17;';
      case 'baja': return 'background-color: #e8f5e9; color: #388e3c;';
      default: return '';
    }
  };

  // Función para mostrar el estado en español
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

  // Generar tabla HTML
  let tasksTableHtml = `
    <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
      <thead>
        <tr style="background-color: #f0f4f8;">
          <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Fecha de vencimiento</th>
          <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Tarea</th>
          <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Prioridad</th>
          <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Estado</th>
        </tr>
      </thead>
      <tbody>`;

  // Generar texto plano
  let tasksListText = '';

  // Procesar cada tarea
  tasks.forEach(task => {
    const dueDate = new Date(task.dueDate);
    
    // Formato de fecha: DD/MM/YYYY
    const day = dueDate.getUTCDate().toString().padStart(2, '0');
    const month = (dueDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = dueDate.getUTCFullYear();
    const formattedDate = `${day}/${month}/${year}`;

    // Obtener la hora si existe
    let formattedTime = "";
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

    // Obtener color y texto para la prioridad
    const priorityColor = getPriorityColor(task.priority);
    const statusText = getStatusText(task.status);

    // Agregar fila a la tabla HTML
    tasksTableHtml += `
      <tr>
        <td style="border: 1px solid #e5e7eb; padding: 12px; color: #4b5563;">${formattedDate}</td>
        <td style="border: 1px solid #e5e7eb; padding: 12px; color: #4b5563;">${task.name}</td>
        <td style="border: 1px solid #e5e7eb; padding: 12px; ${priorityColor}">${task.priority.toUpperCase()}</td>
        <td style="border: 1px solid #e5e7eb; padding: 12px; color: #4b5563;">${statusText}</td>
      </tr>`;

    // Agregar al texto plano
    tasksListText += `- ${formattedDate} ${formattedTime}: ${task.name} (Prioridad: ${task.priority.toUpperCase()}, Estado: ${statusText})\n`;
    if (task.description) {
      tasksListText += `  ${task.description}\n`;
    }
  });

  tasksTableHtml += `
      </tbody>
    </table>`;

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