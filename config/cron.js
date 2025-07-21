const cron = require('node-cron');
const {
  calendarNotificationJob,
  taskNotificationJob,
  movementNotificationJob,
  clearLogsJob,
  judicialMovementNotificationJob
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

/**
 * Configura los trabajos cron para las notificaciones
 */
function setupCronJobs() {
  // Obtener las expresiones cron de las variables de entorno o usar valores predeterminados
  const calendarCron = process.env.NOTIFICATION_CALENDAR_CRON || '0 9 * * *';
  const taskCron = process.env.NOTIFICATION_TASK_CRON || '15 9 * * *';
  const movementCron = process.env.NOTIFICATION_MOVEMENT_CRON || '45 9 * * *';

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
    } catch (error) {
      logger.error(`Error en trabajo de notificaciones de calendario: ${error.message}`);
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
    } catch (error) {
      logger.error(`Error en trabajo de notificaciones de tareas: ${error.message}`);
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
    } catch (error) {
      logger.error(`Error en trabajo de notificaciones de movimientos: ${error.message}`);
    }
  }, {
    scheduled: true,
    timezone: 'America/Argentina/Buenos_Aires'
  });

  // Trabajo adicional para mantener viva la conexión a la base de datos
  cron.schedule('*/30 * * * *', () => {
    logger.debug('Keepalive de la base de datos ejecutado');
  });
  
  // Trabajo para limpiar los logs semanalmente (domingo a las 2:00 AM)
  logger.info('Configurando trabajo de limpieza de logs: 0 2 * * 0');
  cron.schedule('0 2 * * 0', async () => {
    logger.info('Ejecutando trabajo de limpieza de logs');
    try {
      const result = await clearLogsJob();
      logger.info(`Trabajo de limpieza de logs completado: ${result.filesCleared} archivos limpiados`);
    } catch (error) {
      logger.error(`Error en trabajo de limpieza de logs: ${error.message}`);
    }
  }, {
    scheduled: true,
    timezone: 'America/Argentina/Buenos_Aires'
  });

  // Trabajo para notificaciones de movimientos judiciales
  // Se ejecuta cada hora para procesar movimientos pendientes
  const judicialMovementCron = process.env.NOTIFICATION_JUDICIAL_MOVEMENT_CRON || '0 * * * *';
  
  if (!cron.validate(judicialMovementCron)) {
    logger.error(`Expresión cron inválida para notificaciones de movimientos judiciales: ${judicialMovementCron}`);
  } else {
    logger.info(`Configurando notificaciones de movimientos judiciales: ${judicialMovementCron}`);
    cron.schedule(judicialMovementCron, async () => {
      logger.info('Ejecutando trabajo de notificaciones de movimientos judiciales');
      try {
        await judicialMovementNotificationJob();
        logger.info('Trabajo de notificaciones de movimientos judiciales completado');
      } catch (error) {
        logger.error(`Error en trabajo de notificaciones judiciales: ${error.message}`);
      }
    }, {
      scheduled: true,
      timezone: 'America/Argentina/Buenos_Aires'
    });
  }
}

module.exports = { setupCronJobs };