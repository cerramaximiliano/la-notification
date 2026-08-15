const cron = require('node-cron');
const {
  calendarNotificationJob,
  morningDigestJob,
  postalSafeGuardJob,
  taskNotificationJob,
  movementNotificationJob,
  clearLogsJob,
  judicialMovementNotificationJob,
  folderInactivityNotificationJob
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
  // Nota: NOTIFICATION_CALENDAR_CRON / _TASK_CRON / _MOVEMENT_CRON quedaron
  // obsoletas — los tres trabajos ahora corren dentro de la rutina matinal.

  // Rutina matinal unificada: calendario + tareas + vencimientos + inactividad
  // corren en secuencia y se envía UN solo informe al administrador (antes eran
  // 4 crons y 4 correos entre las 9:00 y las 10:00).
  const morningCron = process.env.NOTIFICATION_MORNING_DIGEST_CRON || '0 9 * * *';

  if (!cron.validate(morningCron)) {
    logger.error(`Expresión cron inválida para la rutina matinal: ${morningCron}`);
  } else {
    logger.info(`Configurando rutina matinal de notificaciones: ${morningCron}`);
    cron.schedule(morningCron, async () => {
      logger.info('Ejecutando rutina matinal de notificaciones');
      try {
        await morningDigestJob();
      } catch (error) {
        logger.error(`Error en la rutina matinal: ${error.message}`);
      }
    }, {
      scheduled: true,
      timezone: 'America/Argentina/Buenos_Aires'
    });
  }

  // Trabajo adicional para mantener viva la conexión a la base de datos
  cron.schedule('*/30 * * * *', () => {
    logger.debug('Keepalive de la base de datos ejecutado');
  });
  
  // Trabajo para limpiar los logs semanalmente (domingo a las 2:00 AM)
  const cleanupCron = process.env.CLEANUP_CRON || '0 2 * * 0'; // Domingos a las 2 AM por defecto
  logger.info(`Configurando trabajo de limpieza completa: ${cleanupCron}`);
  
  // Importar la nueva función de limpieza completa
  const { comprehensiveCleanupJob } = require('../cron/cleanupJobs');
  
  cron.schedule(cleanupCron, async () => {
    logger.info('========================================');
    logger.info('Ejecutando limpieza semanal programada');
    logger.info('========================================');
    try {
      const result = await comprehensiveCleanupJob();
      logger.info(`Limpieza semanal completada exitosamente`);
      logger.info(`Total eliminado: ${result.summary.totalDeleted} elementos`);
      logger.info(`Espacio liberado: ${(result.summary.spaceSaved / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
      logger.error(`Error en trabajo de limpieza semanal: ${error.message}`);
    }
  }, {
    scheduled: true,
    timezone: 'America/Argentina/Buenos_Aires'
  });

  // Trabajo para notificaciones de movimientos judiciales
  // Se ejecuta cada 15 minutos para procesar movimientos pendientes
  const judicialMovementCron = process.env.NOTIFICATION_JUDICIAL_MOVEMENT_CRON || '*/15 * * * *';

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

  // Safe guard diario de notificaciones postales (8:00 ART): reintenta los
  // envíos fallidos del webhook y barre postal-trackings por eventos que
  // nunca se notificaron (worker caído, red, deploy).
  const postalSafeGuardCron = process.env.NOTIFICATION_POSTAL_SAFEGUARD_CRON || '0 8 * * *';

  if (!cron.validate(postalSafeGuardCron)) {
    logger.error(`Expresión cron inválida para el safe guard postal: ${postalSafeGuardCron}`);
  } else {
    logger.info(`Configurando safe guard de notificaciones postales: ${postalSafeGuardCron}`);
    cron.schedule(postalSafeGuardCron, async () => {
      logger.info('Ejecutando safe guard de notificaciones postales');
      try {
        await postalSafeGuardJob();
      } catch (error) {
        logger.error(`Error en safe guard postal: ${error.message}`);
      }
    }, {
      scheduled: true,
      timezone: 'America/Argentina/Buenos_Aires'
    });
  }

}

module.exports = { setupCronJobs };