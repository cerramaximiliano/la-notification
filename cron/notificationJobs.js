const mongoose = require('mongoose');
const moment = require('moment');
const { sendEmail } = require('../services/email');
const { 
  sendCalendarNotifications,
  sendTaskNotifications,
  sendMovementNotifications
} = require('../services/notifications');

// Importar los modelos
const User = require('../models/User');
const Event = require('../models/Event');
const Task = require('../models/Task');
const Movement = require('../models/Movement');
const logger = require('../config/logger');

/**
 * Notifica a todos los usuarios de sus próximos eventos de calendario
 */
async function calendarNotificationJob() {
  try {
    logger.info('Iniciando trabajo de notificaciones de calendario');
    
    const daysInAdvance = parseInt(process.env.DEFAULT_DAYS_IN_ADVANCE) || 5;
    logger.info(`Configurado para notificar eventos en los próximos ${daysInAdvance} días`);

    // Obtener todos los usuarios que tienen habilitadas las notificaciones
    const users = await User.find({
      'preferences.notifications.channels.email': { $ne: false },
      'preferences.notifications.user.calendar': { $ne: false }
    });

    logger.info(`Se encontraron ${users.length} usuarios con notificaciones de calendario habilitadas`);

    // Contador de notificaciones
    let totalNotifications = 0;
    let totalSuccessful = 0;

    // Procesar cada usuario
    for (const user of users) {
      try {
        logger.debug(`Procesando notificaciones de calendario para el usuario ${user._id} (${user.email})`);
        
        const result = await sendCalendarNotifications({
          days: daysInAdvance,
          forceDaily: false,
          userId: user._id,
          models: { User, Event },
          utilities: { sendEmail, logger, mongoose }
        });

        if (result.notified) {
          totalNotifications++;
          totalSuccessful++;
          logger.info(`Notificación de calendario enviada a ${user.email} con ${result.count} eventos`);
        } else {
          logger.debug(`No se envió notificación de calendario a ${user.email}: ${result.message}`);
        }
      } catch (userError) {
        logger.error(`Error al procesar calendario para usuario ${user._id}: ${userError.message}`);
      }
    }

    logger.info(`Trabajo de notificaciones de calendario completado: ${totalSuccessful}/${totalNotifications} notificaciones enviadas`);
    return {
      success: true,
      usersProcessed: users.length,
      notificationsSent: totalSuccessful
    };
  } catch (error) {
    logger.error(`Error en el trabajo de notificaciones de calendario: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Notifica a todos los usuarios de sus próximas tareas a vencer
 */
async function taskNotificationJob() {
  try {
    logger.info('Iniciando trabajo de notificaciones de tareas');
    
    const daysInAdvance = parseInt(process.env.DEFAULT_DAYS_IN_ADVANCE) || 5;
    logger.info(`Configurado para notificar tareas en los próximos ${daysInAdvance} días`);

    // Obtener todos los usuarios que tienen habilitadas las notificaciones
    const users = await User.find({
      'preferences.notifications.channels.email': { $ne: false },
      'preferences.notifications.user.expiration': { $ne: false }
    });

    logger.info(`Se encontraron ${users.length} usuarios con notificaciones de tareas habilitadas`);

    // Contador de notificaciones
    let totalNotifications = 0;
    let totalSuccessful = 0;

    // Procesar cada usuario
    for (const user of users) {
      try {
        logger.debug(`Procesando notificaciones de tareas para el usuario ${user._id} (${user.email})`);
        
        const result = await sendTaskNotifications({
          days: daysInAdvance,
          forceDaily: false,
          userId: user._id,
          models: { User, Task },
          utilities: { sendEmail, logger }
        });

        if (result.notified) {
          totalNotifications++;
          totalSuccessful++;
          logger.info(`Notificación de tareas enviada a ${user.email} con ${result.count} tareas`);
        } else {
          logger.debug(`No se envió notificación de tareas a ${user.email}: ${result.message}`);
        }
      } catch (userError) {
        logger.error(`Error al procesar tareas para usuario ${user._id}: ${userError.message}`);
      }
    }

    logger.info(`Trabajo de notificaciones de tareas completado: ${totalSuccessful}/${totalNotifications} notificaciones enviadas`);
    return {
      success: true,
      usersProcessed: users.length,
      notificationsSent: totalSuccessful
    };
  } catch (error) {
    logger.error(`Error en el trabajo de notificaciones de tareas: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Notifica a todos los usuarios de sus próximos movimientos a expirar
 */
async function movementNotificationJob() {
  try {
    logger.info('Iniciando trabajo de notificaciones de movimientos');
    
    const daysInAdvance = parseInt(process.env.DEFAULT_DAYS_IN_ADVANCE) || 5;
    logger.info(`Configurado para notificar movimientos en los próximos ${daysInAdvance} días`);

    // Obtener todos los usuarios que tienen habilitadas las notificaciones
    const users = await User.find({
      'preferences.notifications.channels.email': { $ne: false },
      'preferences.notifications.user.expiration': { $ne: false }
    });

    logger.info(`Se encontraron ${users.length} usuarios con notificaciones de movimientos habilitadas`);

    // Contador de notificaciones
    let totalNotifications = 0;
    let totalSuccessful = 0;

    // Procesar cada usuario
    for (const user of users) {
      try {
        logger.debug(`Procesando notificaciones de movimientos para el usuario ${user._id} (${user.email})`);
        
        const result = await sendMovementNotifications({
          days: daysInAdvance,
          forceDaily: false,
          userId: user._id,
          models: { User, Movement },
          utilities: { sendEmail, logger, mongoose, moment }
        });

        if (result.notified) {
          totalNotifications++;
          totalSuccessful++;
          logger.info(`Notificación de movimientos enviada a ${user.email} con ${result.count} movimientos`);
        } else {
          logger.debug(`No se envió notificación de movimientos a ${user.email}: ${result.message}`);
        }
      } catch (userError) {
        logger.error(`Error al procesar movimientos para usuario ${user._id}: ${userError.message}`);
      }
    }

    logger.info(`Trabajo de notificaciones de movimientos completado: ${totalSuccessful}/${totalNotifications} notificaciones enviadas`);
    return {
      success: true,
      usersProcessed: users.length,
      notificationsSent: totalSuccessful
    };
  } catch (error) {
    logger.error(`Error en el trabajo de notificaciones de movimientos: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  calendarNotificationJob,
  taskNotificationJob,
  movementNotificationJob
};