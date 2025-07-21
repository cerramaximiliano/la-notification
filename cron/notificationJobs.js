const mongoose = require('mongoose');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { sendEmail } = require('../services/email');
const {
  sendCalendarNotifications,
  sendTaskNotifications,
  sendMovementNotifications,
  sendJudicialMovementNotifications,
} = require('../services/notifications');



// Importar los modelos
const User = require('../models/User');
const Event = require('../models/Event');
const Task = require('../models/Task');
const Movement = require('../models/Movement');
const Alert = require("../models/Alert");
const JudicialMovement = require('../models/JudicialMovement');
const NotificationLog = require('../models/NotificationLog');
const logger = require('../config/logger');
const { sendTaskBrowserAlerts, sendMovementBrowserAlerts, sendCalendarBrowserAlerts } = require('../services/browser');

/**
 * Notifica a todos los usuarios de sus próximos eventos de calendario
 */
async function calendarNotificationJob() {
  try {
    logger.info('Iniciando trabajo de notificaciones de calendario');

    // Usamos el valor por defecto para el sistema, pero cada usuario y cada evento
    // pueden tener su propia configuración que será respetada por los controladores
    const defaultDaysInAdvance = parseInt(process.env.DEFAULT_DAYS_IN_ADVANCE) || 5;
    logger.info(`Valor por defecto para notificar eventos: ${defaultDaysInAdvance} días de anticipación`);

    // Obtener todos los usuarios que tienen habilitadas las notificaciones
    // de cualquier tipo (email, navegador o ambas)
    const users = await User.find({
      $and: [
        { 'preferences.notifications.user.calendar': { $ne: false } },
        {
          $or: [
            { 'preferences.notifications.channels.email': { $ne: false } },
            { 'preferences.notifications.channels.browser': true }
          ]
        }
      ]
    });

    logger.info(`Se encontraron ${users.length} usuarios con notificaciones de calendario habilitadas`);

    // Contadores para el informe final
    let totalEmailNotifications = 0;
    let totalBrowserAlerts = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalUsersWithNotifications = 0; // Contador de usuarios que recibieron notificaciones

    // Procesar cada usuario
    for (const user of users) {
      try {
        logger.debug(`Procesando notificaciones de calendario para el usuario ${user._id} (${user.email})`);

        const preferences = user.preferences?.notifications || {};
        const channels = preferences.channels || {};

        // Obtenemos la configuración específica de este usuario
        const userCalendarSettings = preferences.user?.calendarSettings || {};
        const userDaysInAdvance = userCalendarSettings.daysInAdvance || defaultDaysInAdvance;

        logger.debug(`Usuario ${user.email} tiene configuración de días: ${userDaysInAdvance}`);

        let userReceivedNotification = false;

        // Procesamos notificaciones por email si están habilitadas
        if (channels.email !== false) {
          try {
            const emailResult = await sendCalendarNotifications({
              days: userDaysInAdvance, // Pasamos la configuración específica del usuario
              forceDaily: false,
              userId: user._id,
              models: { User, Event },
              utilities: { sendEmail, logger, mongoose }
            });

            if (emailResult.notified) {
              totalEmailNotifications += emailResult.count || 0;
              totalSuccessful++;
              userReceivedNotification = true;
              logger.info(`Notificación de calendario por email enviada a ${user.email} con ${emailResult.count} eventos`);
            } else {
              logger.info(`No se envió notificación de calendario por email a ${user.email}: ${emailResult.message}`);
            }
          } catch (emailError) {
            totalFailed++;
            logger.error(`Error al procesar notificaciones por email para usuario ${user._id}: ${emailError.message}`);
          }
        }

        // Procesamos alertas de navegador si están habilitadas
        if (channels.browser === true) {
          try {
            const browserResult = await sendCalendarBrowserAlerts({
              days: userDaysInAdvance, // Pasamos la configuración específica del usuario
              forceDaily: false,
              userId: user._id,
              models: { User, Event, Alert },
              utilities: { logger, mongoose }
            });

            if (browserResult.notified) {
              totalBrowserAlerts += browserResult.count || 0;
              totalSuccessful++;
              userReceivedNotification = true;
              logger.info(`Alertas de navegador creadas para ${user.email} con ${browserResult.count} eventos`);
            } else {
              logger.info(`No se crearon alertas de navegador para ${user.email}: ${browserResult.message}`);
            }
          } catch (browserError) {
            totalFailed++;
            logger.error(`Error al procesar alertas de navegador para usuario ${user._id}: ${browserError.message}`);
          }
        }

        // Si el usuario recibió al menos una notificación (email o navegador)
        if (userReceivedNotification) {
          totalUsersWithNotifications++;
        }

      } catch (userError) {
        totalFailed++;
        logger.error(`Error general al procesar eventos para usuario ${user._id}: ${userError.message}`);
      }
    }

    // Resumen final
    const summary = {
      success: true,
      usersProcessed: users.length,
      usersNotified: totalUsersWithNotifications, // Contador de usuarios que recibieron notificaciones
      emailNotificationsSent: totalEmailNotifications,
      browserAlertsSent: totalBrowserAlerts,
      totalEventNotifications: totalEmailNotifications + totalBrowserAlerts, // Total combinado
      totalSuccessfulProcesses: totalSuccessful,
      totalFailedProcesses: totalFailed
    };

    logger.info(`Trabajo de notificaciones de calendario completado: ${JSON.stringify(summary)}`);

    // Registrar explícitamente la información para el informe al administrador
    logger.info(`RESUMEN PARA INFORME: Usuarios procesados: ${summary.usersProcessed}, Usuarios notificados: ${summary.usersNotified}, Total notificaciones: ${summary.totalEventNotifications}`);

    // Si está configurado, enviar email al administrador con el resumen del calendario
    // Esta funcionalidad es opcional y se puede integrar con el sistema centralizado
    if (process.env.ADMIN_EMAIL) {
      try {
        const adminEmail = process.env.ADMIN_EMAIL;
        const subject = `Law||Analytics: Informe de notificaciones de calendario`;

        let htmlContent = `
                  <h2>Informe de notificaciones de calendario</h2>
                  <p>El sistema ha procesado las siguientes notificaciones de calendario:</p>
                  
                  <table style="border-collapse: collapse; width: 100%;">
                      <tr style="background-color: #f5f5f5;">
                          <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Métrica</th>
                          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Total</th>
                      </tr>
                      <tr>
                          <td style="border: 1px solid #ddd; padding: 8px;">Usuarios procesados</td>
                          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.usersProcessed}</td>
                      </tr>
                      <tr>
                          <td style="border: 1px solid #ddd; padding: 8px;">Usuarios notificados</td>
                          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.usersNotified}</td>
                      </tr>
                      <tr>
                          <td style="border: 1px solid #ddd; padding: 8px;">Notificaciones por email</td>
                          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.emailNotificationsSent}</td>
                      </tr>
                      <tr>
                          <td style="border: 1px solid #ddd; padding: 8px;">Alertas en navegador</td>
                          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.browserAlertsSent}</td>
                      </tr>
                      <tr style="background-color: #f5f5f5; font-weight: bold;">
                          <td style="border: 1px solid #ddd; padding: 8px;">Total notificaciones</td>
                          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.totalEventNotifications}</td>
                      </tr>
                  </table>
                  
                  <p>Fecha y hora del informe: ${new Date().toLocaleString('es-ES')}</p>
                  <p>Saludos,<br>Sistema de notificaciones de Law||Analytics</p>
              `;

        let textContent = `Informe de notificaciones de calendario\n\n`;
        textContent += `El sistema ha procesado las siguientes notificaciones de calendario:\n\n`;
        textContent += `- Usuarios procesados: ${summary.usersProcessed}\n`;
        textContent += `- Usuarios notificados: ${summary.usersNotified}\n`;
        textContent += `- Notificaciones por email: ${summary.emailNotificationsSent}\n`;
        textContent += `- Alertas en navegador: ${summary.browserAlertsSent}\n`;
        textContent += `- Total notificaciones: ${summary.totalEventNotifications}\n\n`;
        textContent += `Fecha y hora del informe: ${new Date().toLocaleString('es-ES')}\n\n`;
        textContent += `Saludos,\nSistema de notificaciones de Law||Analytics`;

        await sendEmail(adminEmail, subject, htmlContent, textContent);
        logger.info(`Informe de notificaciones de calendario enviado al administrador: ${adminEmail}`);
      } catch (emailError) {
        logger.error(`Error al enviar informe de calendario al administrador: ${emailError.message}`);
      }
    }

    return summary;

  } catch (error) {
    logger.error(`Error general en el trabajo de notificaciones de calendario: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Notifica a todos los usuarios de sus próximas tareas a vencer
 */
async function taskNotificationJob() {
  try {
    logger.info('Iniciando trabajo de notificaciones de tareas');

    // Usamos el valor por defecto para el sistema, pero cada usuario y cada tarea
    // pueden tener su propia configuración que será respetada por los controladores
    const defaultDaysInAdvance = parseInt(process.env.DEFAULT_DAYS_IN_ADVANCE) || 5;
    logger.info(`Valor por defecto para notificar tareas: ${defaultDaysInAdvance} días de anticipación`);

    // Obtener todos los usuarios que tienen habilitadas las notificaciones
    // de cualquier tipo (email, navegador o ambas)
    const users = await User.find({
      $and: [
        { 'preferences.notifications.user.expiration': { $ne: false } },
        {
          $or: [
            { 'preferences.notifications.channels.email': { $ne: false } },
            { 'preferences.notifications.channels.browser': true }
          ]
        }
      ]
    });

    logger.info(`Se encontraron ${users.length} usuarios con notificaciones de tareas habilitadas`);

    // Contadores para el informe final
    let totalEmailNotifications = 0;
    let totalBrowserAlerts = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalUsersWithNotifications = 0; // Contador de usuarios que recibieron notificaciones

    // Procesar cada usuario
    for (const user of users) {
      try {
        logger.debug(`Procesando notificaciones de tareas para el usuario ${user._id} (${user.email})`);

        const preferences = user.preferences?.notifications || {};
        const channels = preferences.channels || {};

        // Obtenemos la configuración específica de este usuario
        const userExpirationSettings = preferences.user?.expirationSettings || {};
        const userDaysInAdvance = userExpirationSettings.daysInAdvance || defaultDaysInAdvance;

        logger.debug(`Usuario ${user.email} tiene configuración de días: ${userDaysInAdvance}`);

        let userReceivedNotification = false;

        // Procesamos notificaciones por email si están habilitadas
        if (channels.email !== false) {
          try {
            const emailResult = await sendTaskNotifications({
              days: userDaysInAdvance, // Pasamos la configuración específica del usuario
              forceDaily: false,
              userId: user._id,
              models: { User, Task },
              utilities: { sendEmail, logger }
            });

            if (emailResult.notified) {
              totalEmailNotifications += emailResult.count || 0;
              totalSuccessful++;
              userReceivedNotification = true;
              logger.info(`Notificación de tareas por email enviada a ${user.email} con ${emailResult.count} tareas`);
            } else {
              logger.info(`No se envió notificación de tareas por email a ${user.email}: ${emailResult.message}`);
            }
          } catch (emailError) {
            totalFailed++;
            logger.error(`Error al procesar notificaciones por email para usuario ${user._id}: ${emailError.message}`);
          }
        }

        // Procesamos alertas de navegador si están habilitadas
        if (channels.browser === true) {
          try {
            const browserResult = await sendTaskBrowserAlerts({
              days: userDaysInAdvance, // Pasamos la configuración específica del usuario
              forceDaily: false,
              userId: user._id,
              models: { User, Task, Alert },
              utilities: { logger, mongoose, moment }
            });

            if (browserResult.notified) {
              totalBrowserAlerts += browserResult.count || 0;
              totalSuccessful++;
              userReceivedNotification = true;
              logger.info(`Alertas de navegador creadas para ${user.email} con ${browserResult.count} tareas`);
            } else {
              logger.info(`No se crearon alertas de navegador para ${user.email}: ${browserResult.message}`);
            }
          } catch (browserError) {
            totalFailed++;
            logger.error(`Error al procesar alertas de navegador para usuario ${user._id}: ${browserError.message}`);
          }
        }

        // Si el usuario recibió al menos una notificación (email o navegador)
        if (userReceivedNotification) {
          totalUsersWithNotifications++;
        }

      } catch (userError) {
        totalFailed++;
        logger.error(`Error general al procesar tareas para usuario ${user._id}: ${userError.message}`);
      }
    }

    // Resumen final
    const summary = {
      success: true,
      usersProcessed: users.length,
      usersNotified: totalUsersWithNotifications, // Nuevo contador para el informe
      emailNotificationsSent: totalEmailNotifications,
      browserAlertsSent: totalBrowserAlerts,
      totalTaskNotifications: totalEmailNotifications + totalBrowserAlerts, // Total combinado
      totalSuccessfulProcesses: totalSuccessful,
      totalFailedProcesses: totalFailed
    };

    logger.info(`Trabajo de notificaciones de tareas completado: ${JSON.stringify(summary)}`);

    // Registrar explícitamente la información para el informe al administrador
    logger.info(`RESUMEN PARA INFORME: Usuarios procesados: ${summary.usersProcessed}, Usuarios notificados: ${summary.usersNotified}, Total notificaciones: ${summary.totalTaskNotifications}`);

    // Si está configurado, enviar email al administrador con el resumen de tareas
    // Esta funcionalidad es opcional y se puede integrar con el sistema centralizado
    if (process.env.ADMIN_EMAIL) {
      try {
        const adminEmail = process.env.ADMIN_EMAIL;
        const subject = `Law||Analytics: Informe de notificaciones de tareas`;

        let htmlContent = `
            <h2>Informe de notificaciones de tareas</h2>
            <p>El sistema ha procesado las siguientes notificaciones de tareas:</p>
            
            <table style="border-collapse: collapse; width: 100%;">
                <tr style="background-color: #f5f5f5;">
                    <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Métrica</th>
                    <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Total</th>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 8px;">Usuarios procesados</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.usersProcessed}</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 8px;">Usuarios notificados</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.usersNotified}</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 8px;">Notificaciones por email</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.emailNotificationsSent}</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 8px;">Alertas en navegador</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.browserAlertsSent}</td>
                </tr>
                <tr style="background-color: #f5f5f5; font-weight: bold;">
                    <td style="border: 1px solid #ddd; padding: 8px;">Total notificaciones</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.totalTaskNotifications}</td>
                </tr>
            </table>
            
            <p>Fecha y hora del informe: ${new Date().toLocaleString('es-ES')}</p>
            <p>Saludos,<br>Sistema de notificaciones de Law||Analytics</p>
        `;

        let textContent = `Informe de notificaciones de tareas\n\n`;
        textContent += `El sistema ha procesado las siguientes notificaciones de tareas:\n\n`;
        textContent += `- Usuarios procesados: ${summary.usersProcessed}\n`;
        textContent += `- Usuarios notificados: ${summary.usersNotified}\n`;
        textContent += `- Notificaciones por email: ${summary.emailNotificationsSent}\n`;
        textContent += `- Alertas en navegador: ${summary.browserAlertsSent}\n`;
        textContent += `- Total notificaciones: ${summary.totalTaskNotifications}\n\n`;
        textContent += `Fecha y hora del informe: ${new Date().toLocaleString('es-ES')}\n\n`;
        textContent += `Saludos,\nSistema de notificaciones de Law||Analytics`;

        await sendEmail(adminEmail, subject, htmlContent, textContent);
        logger.info(`Informe de notificaciones de tareas enviado al administrador: ${adminEmail}`);
      } catch (emailError) {
        logger.error(`Error al enviar informe de tareas al administrador: ${emailError.message}`);
      }
    }

    return summary;

  } catch (error) {
    logger.error(`Error general en el trabajo de notificaciones de tareas: ${error.message}`);
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

    // Usamos el valor por defecto para el sistema, pero cada usuario y cada movimiento
    // pueden tener su propia configuración que será respetada por los controladores
    const defaultDaysInAdvance = parseInt(process.env.DEFAULT_DAYS_IN_ADVANCE) || 5;
    logger.info(`Valor por defecto para notificar movimientos: ${defaultDaysInAdvance} días de anticipación`);

    // Obtener todos los usuarios que tienen habilitadas las notificaciones
    // de cualquier tipo (email, navegador o ambas)
    const users = await User.find({
      $and: [
        { 'preferences.notifications.user.expiration': { $ne: false } },
        {
          $or: [
            { 'preferences.notifications.channels.email': { $ne: false } },
            { 'preferences.notifications.channels.browser': true }
          ]
        }
      ]
    });

    logger.info(`Se encontraron ${users.length} usuarios con notificaciones de movimientos habilitadas`);

    // Contadores para el informe final
    let totalEmailNotifications = 0;
    let totalBrowserAlerts = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalUsersWithNotifications = 0; // Contador de usuarios que recibieron notificaciones

    // Procesar cada usuario
    for (const user of users) {
      try {
        logger.debug(`Procesando notificaciones de movimientos para el usuario ${user._id} (${user.email})`);

        const preferences = user.preferences?.notifications || {};
        const channels = preferences.channels || {};

        // Obtenemos la configuración específica de este usuario
        const userExpirationSettings = preferences.user?.expirationSettings || {};
        const userDaysInAdvance = userExpirationSettings.daysInAdvance || defaultDaysInAdvance;

        logger.debug(`Usuario ${user.email} tiene configuración de días: ${userDaysInAdvance}`);

        let userReceivedNotification = false;

        // Procesamos notificaciones por email si están habilitadas
        if (channels.email !== false) {
          try {
            const emailResult = await sendMovementNotifications({
              days: userDaysInAdvance, // Pasamos la configuración específica del usuario
              forceDaily: false,
              userId: user._id,
              models: { User, Movement },
              utilities: { sendEmail, logger, mongoose, moment }
            });

            if (emailResult.notified) {
              totalEmailNotifications += emailResult.count || 0;
              totalSuccessful++;
              userReceivedNotification = true;
              logger.info(`Notificación de movimientos por email enviada a ${user.email} con ${emailResult.count} movimientos`);
            } else {
              logger.info(`No se envió notificación de movimientos por email a ${user.email}: ${emailResult.message}`);
            }
          } catch (emailError) {
            totalFailed++;
            logger.error(`Error al procesar notificaciones por email para usuario ${user._id}: ${emailError.message}`);
          }
        }

        // Procesamos alertas de navegador si están habilitadas
        if (channels.browser === true) {
          try {
            const browserResult = await sendMovementBrowserAlerts({
              days: userDaysInAdvance, // Pasamos la configuración específica del usuario
              forceDaily: false,
              userId: user._id,
              models: { User, Movement, Alert },
              utilities: { logger, mongoose, moment }
            });

            if (browserResult.notified) {
              totalBrowserAlerts += browserResult.count || 0;
              totalSuccessful++;
              userReceivedNotification = true;
              logger.info(`Alertas de navegador creadas para ${user.email} con ${browserResult.count} movimientos`);
            } else {
              logger.info(`No se crearon alertas de navegador para ${user.email}: ${browserResult.message}`);
            }
          } catch (browserError) {
            totalFailed++;
            logger.error(`Error al procesar alertas de navegador para usuario ${user._id}: ${browserError.message}`);
          }
        }

        // Si el usuario recibió al menos una notificación (email o navegador)
        if (userReceivedNotification) {
          totalUsersWithNotifications++;
        }

      } catch (userError) {
        totalFailed++;
        logger.error(`Error general al procesar movimientos para usuario ${user._id}: ${userError.message}`);
      }
    }

    // Resumen final
    const summary = {
      success: true,
      usersProcessed: users.length,
      usersNotified: totalUsersWithNotifications, // Contador de usuarios que recibieron notificaciones
      emailNotificationsSent: totalEmailNotifications,
      browserAlertsSent: totalBrowserAlerts,
      totalMovementNotifications: totalEmailNotifications + totalBrowserAlerts, // Total combinado
      totalSuccessfulProcesses: totalSuccessful,
      totalFailedProcesses: totalFailed
    };

    logger.info(`Trabajo de notificaciones de movimientos completado: ${JSON.stringify(summary)}`);

    // Registrar explícitamente la información para el informe al administrador
    logger.info(`RESUMEN PARA INFORME: Usuarios procesados: ${summary.usersProcessed}, Usuarios notificados: ${summary.usersNotified}, Total notificaciones: ${summary.totalMovementNotifications}`);

    // Si está configurado, enviar email al administrador con el resumen de movimientos
    // Esta funcionalidad es opcional y se puede integrar con el sistema centralizado
    if (process.env.ADMIN_EMAIL) {
      try {
        const adminEmail = process.env.ADMIN_EMAIL;
        const subject = `Law||Analytics: Informe de notificaciones de movimientos`;

        let htmlContent = `
                  <h2>Informe de notificaciones de movimientos</h2>
                  <p>El sistema ha procesado las siguientes notificaciones de movimientos:</p>
                  
                  <table style="border-collapse: collapse; width: 100%;">
                      <tr style="background-color: #f5f5f5;">
                          <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Métrica</th>
                          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Total</th>
                      </tr>
                      <tr>
                          <td style="border: 1px solid #ddd; padding: 8px;">Usuarios procesados</td>
                          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.usersProcessed}</td>
                      </tr>
                      <tr>
                          <td style="border: 1px solid #ddd; padding: 8px;">Usuarios notificados</td>
                          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.usersNotified}</td>
                      </tr>
                      <tr>
                          <td style="border: 1px solid #ddd; padding: 8px;">Notificaciones por email</td>
                          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.emailNotificationsSent}</td>
                      </tr>
                      <tr>
                          <td style="border: 1px solid #ddd; padding: 8px;">Alertas en navegador</td>
                          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.browserAlertsSent}</td>
                      </tr>
                      <tr style="background-color: #f5f5f5; font-weight: bold;">
                          <td style="border: 1px solid #ddd; padding: 8px;">Total notificaciones</td>
                          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.totalMovementNotifications}</td>
                      </tr>
                  </table>
                  
                  <p>Fecha y hora del informe: ${new Date().toLocaleString('es-ES')}</p>
                  <p>Saludos,<br>Sistema de notificaciones de Law||Analytics</p>
              `;

        let textContent = `Informe de notificaciones de movimientos\n\n`;
        textContent += `El sistema ha procesado las siguientes notificaciones de movimientos:\n\n`;
        textContent += `- Usuarios procesados: ${summary.usersProcessed}\n`;
        textContent += `- Usuarios notificados: ${summary.usersNotified}\n`;
        textContent += `- Notificaciones por email: ${summary.emailNotificationsSent}\n`;
        textContent += `- Alertas en navegador: ${summary.browserAlertsSent}\n`;
        textContent += `- Total notificaciones: ${summary.totalMovementNotifications}\n\n`;
        textContent += `Fecha y hora del informe: ${new Date().toLocaleString('es-ES')}\n\n`;
        textContent += `Saludos,\nSistema de notificaciones de Law||Analytics`;

        await sendEmail(adminEmail, subject, htmlContent, textContent);
        logger.info(`Informe de notificaciones de movimientos enviado al administrador: ${adminEmail}`);
      } catch (emailError) {
        logger.error(`Error al enviar informe de movimientos al administrador: ${emailError.message}`);
      }
    }

    return summary;

  } catch (error) {
    logger.error(`Error general en el trabajo de notificaciones de movimientos: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Trabajo cron para eliminar/limpiar todos los archivos de logs
 * @returns {Object} Resultado de la operación
 */
async function clearLogsJob() {
  logger.info('Iniciando trabajo de limpieza de logs');

  const logDir = path.join(__dirname, '../logs');
  let deleted = 0;
  let errors = 0;

  try {
    // Obtener información del sistema para el informe
    const diskUsageBefore = await getDiskUsageInfo();
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    // Obtener tamaños de los archivos de log antes de limpiarlos
    const fileStats = {};
    const files = fs.readdirSync(logDir);

    for (const file of files) {
      try {
        const filePath = path.join(logDir, file);
        const stats = fs.statSync(filePath);
        fileStats[file] = {
          size: (stats.size / 1024 / 1024).toFixed(2), // Tamaño en MB
          modified: stats.mtime
        };
      } catch (err) {
        logger.error(`Error al obtener estadísticas del archivo ${file}: ${err.message}`);
      }
    }

    // Limpiar archivos de log
    for (const file of files) {
      // Evitar eliminar archivos que están siendo usados activamente por PM2
      if (file !== 'pm2-error.log' && file !== 'pm2-out.log') {
        try {
          const filePath = path.join(logDir, file);
          // Vaciar el contenido del archivo en lugar de eliminarlo
          fs.writeFileSync(filePath, '', { flag: 'w' });
          logger.info(`Archivo de log limpiado: ${file}`);
          deleted++;
        } catch (err) {
          logger.error(`Error al limpiar el archivo de log ${file}: ${err.message}`);
          errors++;
        }
      }
    }

    // Obtener uso de disco después de la limpieza
    const diskUsageAfter = await getDiskUsageInfo();

    // Calcular espacio liberado
    const spaceSaved = diskUsageBefore.used - diskUsageAfter.used;

    // Obtener información sobre conexiones a la base de datos
    const dbStatus = mongoose.connection.readyState === 1 ? 'Conectado' : 'Desconectado';

    // Resumen final
    const summary = {
      success: true,
      filesProcessed: files.length,
      filesCleared: deleted,
      errors: errors,
      fileStats: fileStats,
      systemInfo: {
        diskUsageBefore: diskUsageBefore,
        diskUsageAfter: diskUsageAfter,
        spaceSaved: (spaceSaved / 1024 / 1024).toFixed(2) + ' MB',
        memoryUsage: {
          rss: (memoryUsage.rss / 1024 / 1024).toFixed(2) + ' MB',
          heapTotal: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
          heapUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB'
        },
        uptime: formatUptime(uptime),
        dbStatus: dbStatus,
        nodeVersion: process.version,
        platform: process.platform,
        serverTime: new Date().toLocaleString('es-ES', { timeZone: 'America/Argentina/Buenos_Aires' })
      }
    };

    logger.info(`Trabajo de limpieza de logs completado: ${JSON.stringify(summary)}`);

    // Si está configurado, enviar email al administrador con el resumen
    if (process.env.ADMIN_EMAIL) {
      try {
        const adminEmail = process.env.ADMIN_EMAIL;
        const subject = `Law||Analytics: Informe de limpieza de logs`;

        let htmlContent = `
          <h2>Informe de limpieza de logs</h2>
          <p>El sistema ha completado la limpieza semanal de archivos de log:</p>
          
          <table style="border-collapse: collapse; width: 100%;">
              <tr style="background-color: #f5f5f5;">
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Métrica</th>
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Total</th>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Archivos procesados</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.filesProcessed}</td>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Archivos limpiados</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.filesCleared}</td>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Errores</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.errors}</td>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Espacio liberado</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.systemInfo.spaceSaved}</td>
              </tr>
          </table>
          
          <h3>Detalle de archivos procesados</h3>
          <table style="border-collapse: collapse; width: 100%;">
              <tr style="background-color: #f5f5f5;">
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Archivo</th>
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Tamaño (MB)</th>
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Última modificación</th>
              </tr>
              ${Object.entries(summary.fileStats).map(([file, stats]) => `
                <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">${file}</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${stats.size}</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${new Date(stats.modified).toLocaleString('es-ES')}</td>
                </tr>
              `).join('')}
          </table>
          
          <h3>Estado del sistema</h3>
          <table style="border-collapse: collapse; width: 100%;">
              <tr style="background-color: #f5f5f5;">
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Métrica</th>
                  <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Valor</th>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Uso de disco antes</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${(summary.systemInfo.diskUsageBefore.used / 1024 / 1024 / 1024).toFixed(2)} GB de ${(summary.systemInfo.diskUsageBefore.total / 1024 / 1024 / 1024).toFixed(2)} GB (${summary.systemInfo.diskUsageBefore.usedPercentage}%)</td>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Uso de disco después</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${(summary.systemInfo.diskUsageAfter.used / 1024 / 1024 / 1024).toFixed(2)} GB de ${(summary.systemInfo.diskUsageAfter.total / 1024 / 1024 / 1024).toFixed(2)} GB (${summary.systemInfo.diskUsageAfter.usedPercentage}%)</td>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Memoria RAM (RSS)</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.systemInfo.memoryUsage.rss}</td>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Estado de la BD</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.systemInfo.dbStatus}</td>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Tiempo de actividad</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.systemInfo.uptime}</td>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Versión de Node.js</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${summary.systemInfo.nodeVersion}</td>
              </tr>
              <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">Puerto del servidor</td>
                  <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${process.env.PORT_NOTIFICATIONS || 3004}</td>
              </tr>
          </table>
          
          <p>Fecha y hora del informe: ${summary.systemInfo.serverTime}</p>
          <p>Saludos,<br>Sistema de notificaciones de Law||Analytics</p>
        `;

        let textContent = `Informe de limpieza de logs\n\n`;
        textContent += `El sistema ha completado la limpieza semanal de archivos de log:\n\n`;
        textContent += `- Archivos procesados: ${summary.filesProcessed}\n`;
        textContent += `- Archivos limpiados: ${summary.filesCleared}\n`;
        textContent += `- Errores: ${summary.errors}\n`;
        textContent += `- Espacio liberado: ${summary.systemInfo.spaceSaved}\n\n`;

        textContent += `Estado del sistema:\n`;
        textContent += `- Uso de disco: ${(summary.systemInfo.diskUsageAfter.used / 1024 / 1024 / 1024).toFixed(2)} GB de ${(summary.systemInfo.diskUsageAfter.total / 1024 / 1024 / 1024).toFixed(2)} GB (${summary.systemInfo.diskUsageAfter.usedPercentage}%)\n`;
        textContent += `- Memoria RAM: ${summary.systemInfo.memoryUsage.rss}\n`;
        textContent += `- Estado de la BD: ${summary.systemInfo.dbStatus}\n`;
        textContent += `- Tiempo de actividad: ${summary.systemInfo.uptime}\n\n`;

        textContent += `Fecha y hora del informe: ${summary.systemInfo.serverTime}\n\n`;
        textContent += `Saludos,\nSistema de notificaciones de Law||Analytics`;

        await sendEmail(adminEmail, subject, htmlContent, textContent);
        logger.info(`Informe de limpieza de logs enviado al administrador: ${adminEmail}`);
      } catch (emailError) {
        logger.error(`Error al enviar informe de limpieza de logs al administrador: ${emailError.message}`);
      }
    }

    return summary;

  } catch (err) {
    logger.error(`Error general en el trabajo de limpieza de logs: ${err.message}`);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Obtiene información sobre el uso del disco
 * @returns {Promise<Object>} Información del disco
 */
async function getDiskUsageInfo() {
  try {
    // Usar 'df' para obtener información del sistema de archivos
    const { execSync } = require('child_process');
    const output = execSync('df -k / | tail -1').toString().trim();
    const parts = output.split(/\s+/);

    // Formato típico: Filesystem 1K-blocks Used Available Use% Mounted on
    const total = parseInt(parts[1], 10) * 1024; // Convertir bloques de 1K a bytes
    const used = parseInt(parts[2], 10) * 1024;
    const available = parseInt(parts[3], 10) * 1024;
    const usedPercentage = parts[4].replace('%', '');

    return {
      total,
      used,
      available,
      usedPercentage
    };
  } catch (error) {
    logger.error(`Error al obtener información del disco: ${error.message}`);
    return {
      total: 0,
      used: 0,
      available: 0,
      usedPercentage: '0'
    };
  }
}

/**
 * Formatea el tiempo de actividad en formato legible
 * @param {number} uptime - Tiempo de actividad en segundos
 * @returns {string} Tiempo formateado
 */
function formatUptime(uptime) {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  let result = '';
  if (days > 0) result += `${days} día${days > 1 ? 's' : ''}, `;
  if (hours > 0) result += `${hours} hora${hours > 1 ? 's' : ''}, `;
  if (minutes > 0) result += `${minutes} minuto${minutes > 1 ? 's' : ''}, `;
  result += `${seconds} segundo${seconds > 1 ? 's' : ''}`;

  return result;
}

/**
 * Procesa y envía notificaciones de movimientos judiciales
 * Este job busca movimientos pendientes que deben notificarse según su hora programada
 */
async function judicialMovementNotificationJob() {
  try {
    logger.info('Iniciando trabajo de notificaciones de movimientos judiciales');

    // Buscar todos los usuarios que tienen movimientos pendientes de notificar
    const now = new Date();
    const pendingMovements = await JudicialMovement.aggregate([
      {
        $match: {
          notificationStatus: 'pending',
          'notificationSettings.notifyAt': { $lte: now }
        }
      },
      {
        $group: {
          _id: '$userId',
          count: { $sum: 1 },
          movements: { $push: '$$ROOT' }
        }
      }
    ]);

    logger.info(`Se encontraron ${pendingMovements.length} usuarios con movimientos judiciales pendientes`);

    let totalNotifications = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;

    // Procesar cada usuario
    for (const group of pendingMovements) {
      try {
        const userId = group._id;
        const user = await User.findById(userId);

        if (!user) {
          logger.warn(`Usuario ${userId} no encontrado, marcando movimientos como fallidos`);
          await JudicialMovement.updateMany(
            { userId, notificationStatus: 'pending' },
            { 
              $set: { notificationStatus: 'failed' },
              $push: {
                notifications: {
                  date: new Date(),
                  type: 'system',
                  success: false,
                  details: 'Usuario no encontrado'
                }
              }
            }
          );
          totalFailed += group.count;
          continue;
        }

        // Enviar notificaciones
        const result = await sendJudicialMovementNotifications({
          userId: user._id,
          models: { User, JudicialMovement, NotificationLog },
          utilities: { sendEmail, logger, moment }
        });

        if (result.success && result.notified) {
          totalNotifications += result.count || 0;
          totalSuccessful++;
          logger.info(`Notificación de movimientos judiciales enviada a ${user.email} con ${result.count} movimientos`);
        } else if (!result.success) {
          totalFailed++;
          logger.error(`Error al enviar notificaciones judiciales a ${user.email}: ${result.message}`);
        }

      } catch (userError) {
        totalFailed++;
        logger.error(`Error procesando movimientos judiciales para usuario ${group._id}: ${userError.message}`);
      }
    }

    // Limpiar movimientos antiguos (opcional: mantener historial de 30 días)
    const thirtyDaysAgo = moment().subtract(30, 'days').toDate();
    const cleanupResult = await JudicialMovement.deleteMany({
      notificationStatus: 'sent',
      'movimiento.fecha': { $lt: thirtyDaysAgo }
    });

    logger.info(`Trabajo de notificaciones de movimientos judiciales completado:`);
    logger.info(`- Total de notificaciones enviadas: ${totalNotifications}`);
    logger.info(`- Usuarios procesados exitosamente: ${totalSuccessful}`);
    logger.info(`- Usuarios con errores: ${totalFailed}`);
    logger.info(`- Movimientos antiguos eliminados: ${cleanupResult.deletedCount}`);

  } catch (error) {
    logger.error(`Error crítico en trabajo de notificaciones judiciales: ${error.message}`, error);
  }
}

module.exports = {
  calendarNotificationJob,
  taskNotificationJob,
  movementNotificationJob,
  clearLogsJob,
  judicialMovementNotificationJob
};