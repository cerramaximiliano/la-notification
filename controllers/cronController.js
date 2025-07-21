const {
  calendarNotificationJob,
  taskNotificationJob,
  movementNotificationJob,
  clearLogsJob
} = require('../cron/notificationJobs');
const logger = require('../config/logger');

/**
 * Ejecuta manualmente un trabajo cron específico
 * Solo accesible para administradores
 */
const executeCronJob = async (req, res) => {
  try {
    const { jobType } = req.body;
    
    if (!jobType) {
      return res.status(400).json({
        success: false,
        message: 'Debe especificar el tipo de trabajo a ejecutar'
      });
    }

    let result;
    const startTime = Date.now();

    switch (jobType) {
      case 'calendar':
        logger.info('Ejecutando manualmente trabajo de notificaciones de calendario');
        result = await calendarNotificationJob();
        break;
        
      case 'tasks':
        logger.info('Ejecutando manualmente trabajo de notificaciones de tareas');
        result = await taskNotificationJob();
        break;
        
      case 'movements':
        logger.info('Ejecutando manualmente trabajo de notificaciones de movimientos');
        result = await movementNotificationJob();
        break;
        
      case 'clearLogs':
        logger.info('Ejecutando manualmente trabajo de limpieza de logs');
        result = await clearLogsJob();
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: 'Tipo de trabajo no válido. Use: calendar, tasks, movements o clearLogs'
        });
    }

    const executionTime = Date.now() - startTime;
    
    logger.info(`Trabajo cron ${jobType} ejecutado manualmente en ${executionTime}ms`);
    
    res.json({
      success: true,
      message: `Trabajo ${jobType} ejecutado exitosamente`,
      executionTime: `${executionTime}ms`,
      result
    });

  } catch (error) {
    logger.error(`Error ejecutando trabajo cron manualmente: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error al ejecutar el trabajo cron',
      error: error.message
    });
  }
};

/**
 * Ejecuta todos los trabajos cron de notificaciones
 * Solo accesible para administradores
 */
const executeAllCronJobs = async (req, res) => {
  try {
    logger.info('Ejecutando manualmente todos los trabajos cron');
    
    const results = {};
    const startTime = Date.now();
    
    // Ejecutar trabajos en paralelo
    const [calendar, tasks, movements] = await Promise.allSettled([
      calendarNotificationJob(),
      taskNotificationJob(),
      movementNotificationJob()
    ]);
    
    results.calendar = calendar.status === 'fulfilled' ? calendar.value : { error: calendar.reason.message };
    results.tasks = tasks.status === 'fulfilled' ? tasks.value : { error: tasks.reason.message };
    results.movements = movements.status === 'fulfilled' ? movements.value : { error: movements.reason.message };
    
    const executionTime = Date.now() - startTime;
    
    logger.info(`Todos los trabajos cron ejecutados manualmente en ${executionTime}ms`);
    
    res.json({
      success: true,
      message: 'Todos los trabajos ejecutados',
      executionTime: `${executionTime}ms`,
      results
    });

  } catch (error) {
    logger.error(`Error ejecutando todos los trabajos cron: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error al ejecutar los trabajos cron',
      error: error.message
    });
  }
};

module.exports = {
  executeCronJob,
  executeAllCronJobs
};