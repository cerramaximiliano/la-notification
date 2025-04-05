const cron = require('node-cron');
const { 
  calendarNotificationJob,
  taskNotificationJob,
  movementNotificationJob
} = require('../cron/notificationJobs');
const { sendEmail } = require('../services/email');
const logger = require('./logger');

// Correo para recibir resultados de los trabajos
const ADMIN_EMAIL = 'cerramaximiliano@gmail.com';

/**
 * Envía un informe por correo sobre el resultado de un trabajo cron
 * 
 * @param {string} jobType - Tipo de trabajo (calendario, tareas, movimientos)
 * @param {Object} result - Resultado de la ejecución del trabajo
 * @param {Error|null} error - Error, si ocurrió alguno
 */
async function sendJobReport(jobType, result, error = null) {
  try {
    const date = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    const subject = `Informe de trabajo cron: ${jobType} - ${date}`;
    
    let htmlContent = `
      <h2>Informe de ejecución de trabajo cron: ${jobType}</h2>
      <p><strong>Fecha y hora:</strong> ${date}</p>
      <p><strong>Estado:</strong> ${error ? 'Error' : 'Completado'}</p>
    `;
    
    if (error) {
      htmlContent += `
        <h3>Error</h3>
        <p style="color: red;">${error.message}</p>
        <pre style="background-color: #f8f8f8; padding: 10px; border: 1px solid #ddd;">${error.stack || 'No hay stack trace disponible'}</pre>
      `;
    } else if (result) {
      htmlContent += `
        <h3>Resultados</h3>
        <ul>
          <li><strong>Usuarios procesados:</strong> ${result.usersProcessed || 0}</li>
          <li><strong>Notificaciones enviadas:</strong> ${result.notificationsSent || 0}</li>
        </ul>
      `;
    }
    
    htmlContent += `
      <p>Este es un correo automático generado por el sistema de notificaciones.</p>
    `;
    
    // Versión en texto plano
    const textContent = `
      Informe de ejecución de trabajo cron: ${jobType}
      Fecha y hora: ${date}
      Estado: ${error ? 'Error' : 'Completado'}
      
      ${error ? `Error: ${error.message}` : ''}
      
      ${result ? `Resultados:
      - Usuarios procesados: ${result.usersProcessed || 0}
      - Notificaciones enviadas: ${result.notificationsSent || 0}
      ` : ''}
      
      Este es un correo automático generado por el sistema de notificaciones.
    `;
    
    await sendEmail(ADMIN_EMAIL, subject, htmlContent, textContent);
    logger.info(`Informe del trabajo ${jobType} enviado a ${ADMIN_EMAIL}`);
  } catch (emailError) {
    logger.error(`Error al enviar informe por correo: ${emailError.message}`);
  }
}

/**
 * Configura los trabajos cron para las notificaciones
 */
function setupCronJobs() {
  // Obtener las expresiones cron de las variables de entorno o usar valores predeterminados
  const calendarCron = process.env.NOTIFICATION_CALENDAR_CRON || '0 9 * * *';
  const taskCron = process.env.NOTIFICATION_TASK_CRON || '15 9 * * *';
  const movementCron = process.env.NOTIFICATION_MOVEMENT_CRON || '30 9 * * *';

  // Validar las expresiones cron
  if (!cron.validate(calendarCron)) {
    logger.error(`Expresión cron inválida para notificaciones de calendario: ${calendarCron}`);
    return;
  }

  if (!cron.validate(taskCron)) {
    logger.error(`Expresión cron inválida para notificaciones de tareas: ${taskCron}`);
    return;
  }

  if (!cron.validate(movementCron)) {
    logger.error(`Expresión cron inválida para notificaciones de movimientos: ${movementCron}`);
    return;
  }

  // Configurar los trabajos cron
  logger.info(`Configurando notificaciones de calendario: ${calendarCron}`);
  cron.schedule(calendarCron, async () => {
    logger.info('Ejecutando trabajo de notificaciones de calendario');
    let result;
    try {
      result = await calendarNotificationJob();
      logger.info('Trabajo de notificaciones de calendario completado');
      // Enviar informe de éxito
      //await sendJobReport('Calendario', result);
    } catch (error) {
      logger.error(`Error en trabajo de notificaciones de calendario: ${error.message}`);
      // Enviar informe de error
      //await sendJobReport('Calendario', null, error);
    }
  }, {
    scheduled: true,
    timezone: 'America/Argentina/Buenos_Aires'
  });

  logger.info(`Configurando notificaciones de tareas: ${taskCron}`);
  cron.schedule(taskCron, async () => {
    logger.info('Ejecutando trabajo de notificaciones de tareas');
    let result;
    try {
      result = await taskNotificationJob();
      logger.info('Trabajo de notificaciones de tareas completado');
      // Enviar informe de éxito
      //await sendJobReport('Tareas', result);
    } catch (error) {
      logger.error(`Error en trabajo de notificaciones de tareas: ${error.message}`);
      // Enviar informe de error
      //await sendJobReport('Tareas', null, error);
    }
  }, {
    scheduled: true,
    timezone: 'America/Argentina/Buenos_Aires'
  });

  logger.info(`Configurando notificaciones de movimientos: ${movementCron}`);
  cron.schedule(movementCron, async () => {
    logger.info('Ejecutando trabajo de notificaciones de movimientos');
    let result;
    try {
      result = await movementNotificationJob();
      logger.info('Trabajo de notificaciones de movimientos completado');
      // Enviar informe de éxito
      //await sendJobReport('Movimientos', result);
    } catch (error) {
      logger.error(`Error en trabajo de notificaciones de movimientos: ${error.message}`);
      // Enviar informe de error
      //await sendJobReport('Movimientos', null, error);
    }
  }, {
    scheduled: true,
    timezone: 'America/Argentina/Buenos_Aires'
  });

  // Trabajo adicional para mantener viva la conexión a la base de datos
  cron.schedule('*/30 * * * *', () => {
    logger.debug('Keepalive de la base de datos ejecutado');
  });
}

module.exports = { setupCronJobs };