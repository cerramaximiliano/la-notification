const mongoose = require('mongoose');
const moment = require('moment');
const { sendEmail } = require('../services/email');
const {
  sendCalendarNotifications,
  sendTaskNotifications,
  sendMovementNotifications,
  sendTaskBrowserAlerts,
  sendMovementBrowserAlerts,
  sendCalendarBrowserAlerts,
} = require('../services/notifications');

// Importar los modelos
const User = require('../models/User');
const Event = require('../models/Event');
const Task = require('../models/Task');
const Movement = require('../models/Movement');
const Alert = require("../models/Alert");
const logger = require('../config/logger');

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
              utilities: { logger }
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

module.exports = {
  calendarNotificationJob,
  taskNotificationJob,
  movementNotificationJob
};