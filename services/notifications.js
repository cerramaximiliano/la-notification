const mongoose = require("mongoose");
const moment = require("moment");
const logger = require("../config/logger");
const { sendEmail } = require("./email");
const { User, Event, Task, Movement, Alert, NotificationLog, JudicialMovement, EmailTemplate } = require("../models");
const { addNotificationAtomic } = require("./notificationHelper");
const { getProcessedTemplate, processJudicialMovementsData } = require("./templateProcessor");

/**
 * Genera el wrapper HTML base para todos los emails
 * @param {string} title - Título del email
 * @param {string} content - Contenido HTML del email
 * @returns {string} HTML completo con estilos y responsive design
 */
function generateEmailTemplate(title, content) {
  return `<!DOCTYPE html>
<html lang="es" style="width: 100%; max-width: 100%; overflow-x: hidden;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Law||Analytics</title>
  <style>
    @media screen and (max-width: 600px) {
      body { margin: 0 !important; padding: 0 !important; }
      .container { width: 100% !important; padding: 15px !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box !important; }
      .content-block { padding: 0 !important; }
      .feature-box { padding: 15px !important; }
      .feature-box div.feature-wrapper { display: block !important; width: 100% !important; }
      .feature-item { width: 100% !important; max-width: 100% !important; margin-bottom: 15px !important; flex: none !important; }
      .footer-links a { display: block !important; margin: 5px 0 !important; }
      h1 { font-size: 20px !important; }
      h2 { font-size: 18px !important; }
      .button { width: auto !important; display: block !important; margin: 0 auto !important; max-width: 100% !important; box-sizing: border-box !important; }
      .logo img { max-width: 150px !important; height: auto !important; }
      p, h1, h2, h3, h4, div, ul, ol, li { max-width: 100% !important; box-sizing: border-box !important; word-wrap: break-word !important; }
      table { width: 100% !important; }
      td, th { padding: 8px !important; font-size: 14px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; background-color: #f0f4f8; width: 100%; overflow-x: hidden;">
  <div class="container" style="max-width: 600px; margin: 0 auto; padding: 30px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); box-sizing: border-box;">
    <div class="logo" style="text-align: center; margin-bottom: 30px; max-width: 100%; box-sizing: border-box;">
      <img src="https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png" alt="Law||Analytics Logo" style="max-width: 180px; height: auto;">
    </div>
    
    <div class="content-block" style="margin-bottom: 30px; max-width: 100%; box-sizing: border-box; word-wrap: break-word;">
      ${content}
    </div>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
    
    <p style="font-size: 14px; color: #6b7280; margin-bottom: 15px; line-height: 1.5; text-align: justify; max-width: 100%; box-sizing: border-box; word-wrap: break-word;">
      Si tiene alguna pregunta, nuestro equipo está disponible en <a href="mailto:soporte@lawanalytics.app" style="color: #2563eb; text-decoration: none;">soporte@lawanalytics.app</a>
    </p>
    
    <div style="font-size: 12px; color: #6b7280; max-width: 100%; box-sizing: border-box; word-wrap: break-word;">
      <p style="margin-bottom: 10px; text-align: center; max-width: 100%; box-sizing: border-box; word-wrap: break-word;">© 2025 Law||Analytics - Todos los derechos reservados</p>
      <p class="footer-links" style="line-height: 1.6; text-align: center; max-width: 100%; box-sizing: border-box; word-wrap: break-word;">
        <a href="${process.env.BASE_URL || 'https://lawanalytics.app'}/privacy-policy" style="color: #2563eb; margin-right: 10px; display: inline-block; text-decoration: none;">Política de privacidad</a>
        <a href="${process.env.BASE_URL || 'https://lawanalytics.app'}/terms" style="color: #2563eb; margin-right: 10px; display: inline-block; text-decoration: none;">Términos de servicio</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

/* Movements Notifications */
async function sendMovementNotifications({
    days: requestedDaysInAdvance = null,
    forceDaily = false,
    userId: requestUserId,
    user: reqUser,
    models: { User, Movement },
    utilities: { sendEmail, logger, mongoose, moment }
}) {
    try {
        // Obtener userId, ya sea del parámetro directo o del objeto de usuario
        const userId = requestUserId || (reqUser && reqUser._id);

        if (!userId) {
            return {
                success: false,
                statusCode: 400,
                message: 'Se requiere un ID de usuario. Proporcione userId como parámetro o use una sesión autenticada.'
            };
        }

        const userObjectId = typeof userId === 'string' ? userId : userId.toString();

        // Buscar el usuario y verificar sus preferencias
        const user = await User.findById(userObjectId);

        if (!user) {
            return {
                success: false,
                statusCode: 404,
                message: 'Usuario no encontrado'
            };
        }

        // Verificar si las notificaciones por email están habilitadas
        const preferences = user.preferences || {};
        const notifications = preferences.notifications || {};
        const emailEnabled = notifications.channels && notifications.channels.email !== false;

        // Para movements usamos el mismo tipo de notificación que expiration
        const userNotificationsEnabled = notifications.user && notifications.user.expiration !== false;

        if (!emailEnabled || !userNotificationsEnabled) {
            return {
                success: true,
                statusCode: 200,
                message: 'Las notificaciones por email para movimientos no están habilitadas para este usuario',
                notified: false
            };
        }

        // Obtener la configuración global de notificaciones del usuario
        // Usamos expirationSettings como configuración general para fechas de expiración
        const userExpirationSettings =
            notifications.user &&
                notifications.user.expirationSettings ?
                notifications.user.expirationSettings :
                { notifyOnceOnly: true, daysInAdvance: 5 };

        // Orden de prioridad para daysInAdvance:
        // 1. Parámetro explícito en la llamada a la función
        // 2. Configuración global del usuario
        // 3. Valor por defecto (5)
        const globalDaysInAdvance = requestedDaysInAdvance || userExpirationSettings.daysInAdvance || 5;

        if (globalDaysInAdvance < 1) {
            return {
                success: false,
                statusCode: 400,
                message: 'El número de días debe ser un valor positivo'
            };
        }

        // Calcular las fechas límites para el rango usando UTC
        const today = moment.utc().startOf('day').toDate();

        // Utilizamos el valor máximo posible para el futureDate inicial
        // para luego filtrar según la configuración específica de cada movimiento
        const maxDaysInAdvance = 30; // Valor arbitrario pero razonable como máximo
        const maxFutureDate = moment.utc().startOf('day').add(maxDaysInAdvance, 'days').endOf('day').toDate();

        const todayDateString = moment.utc().format('YYYY-MM-DD');
        const ObjectId = mongoose.Types.ObjectId;

        // Búsqueda inicial de movimientos en el rango máximo de fechas
        let initialMovements = await Movement.find({
            userId: new ObjectId(userObjectId),
            dateExpiration: {
                $exists: true,
                $ne: null,
                $gte: today,
                $lte: maxFutureDate
            }
        }).sort({ dateExpiration: 1 });

        // Ahora filtramos manualmente según la configuración específica de cada movimiento
        const upcomingMovements = initialMovements.filter(movement => {
            // Determinar los días de anticipación para este movimiento específico
            // Orden de prioridad:
            // 1. Configuración específica del movimiento
            // 2. Configuración global del usuario
            const movementDaysInAdvance =
                (movement.notificationSettings && typeof movement.notificationSettings.daysInAdvance === 'number') ?
                    movement.notificationSettings.daysInAdvance :
                    globalDaysInAdvance;

            // Calcular la fecha límite específica para este movimiento
            const movementFutureDate = moment.utc(today).add(movementDaysInAdvance, 'days').endOf('day').toDate();

            // Verificar si el movimiento está dentro del rango específico
            const expirationDate = moment.utc(movement.dateExpiration).toDate();

            // El movimiento debe estar dentro del rango de días configurado
            const isInRange = expirationDate <= movementFutureDate;

            // Verificar si ya fue notificado (según la configuración de notifyOnceOnly)
            let shouldNotify = true;

            // Determinar si el movimiento permite múltiples notificaciones
            const notifyOnceOnly =
                (movement.notificationSettings && typeof movement.notificationSettings.notifyOnceOnly === 'boolean') ?
                    movement.notificationSettings.notifyOnceOnly :
                    userExpirationSettings.notifyOnceOnly;

            // Si está configurado para notificar solo una vez y ya tiene notificaciones por email
            if (notifyOnceOnly &&
                movement.notifications &&
                movement.notifications.some(n => n.type === 'email')) {
                shouldNotify = false;
            }

            // Si permite múltiples notificaciones, verificar si ya se notificó hoy
            if (shouldNotify &&
                !notifyOnceOnly &&
                movement.notifications &&
                movement.notifications.some(n => {
                    const notificationDate = moment.utc(n.date).format('YYYY-MM-DD');
                    return n.type === 'email' && notificationDate === todayDateString;
                })) {
                shouldNotify = false;
            }

            // Si estamos forzando notificaciones diarias, ignoramos las verificaciones anteriores
            if (forceDaily) {
                shouldNotify = true;

                // Pero aún así verificamos si ya se notificó hoy
                if (movement.notifications &&
                    movement.notifications.some(n => {
                        const notificationDate = moment.utc(n.date).format('YYYY-MM-DD');
                        return n.type === 'email' && notificationDate === todayDateString;
                    })) {
                    shouldNotify = false;
                }
            }

            // El movimiento debe estar en el rango y cumplir con las reglas de notificación
            return isInRange && shouldNotify;
        });

        if (upcomingMovements.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: 'No hay movimientos próximos a expirar para notificar o ya fueron notificados según su configuración',
                notified: false,
                forceDaily: forceDaily,
                daysInAdvance: globalDaysInAdvance
            };
        }

        // Usar el template de la base de datos
        const { processMovementsData } = require('./movementTemplateProcessor');
        const { getProcessedTemplate } = require('./templateProcessor');
        
        // Crear un array para los IDs de movimientos que se notificarán
        const notifiedMovementIds = upcomingMovements.map(movement => {
            // Log de configuración específica
            const movementSpecificDays = movement.notificationSettings?.daysInAdvance || globalDaysInAdvance;
            logger.debug(`Notificación por email para movimiento ${movement._id} (${movement.title}) usando configuración de días: ${movementSpecificDays}`);
            return movement._id;
        });
        
        // Procesar datos de los movimientos
        const templateVariables = processMovementsData(upcomingMovements, user);
        
        // Obtener template procesado
        const processedTemplate = await getProcessedTemplate('notification', 'movements-expiration', templateVariables);
        
        const subject = processedTemplate.subject;
        const htmlContent = processedTemplate.html;
        const textContent = processedTemplate.text;
        
        logger.info('Usando template de base de datos para notificaciones de movimientos');
        
        // Enviar el correo electrónico
        let emailStatus = 'sent';
        let failureReason = null;
        
        try {
            await sendEmail(user.email, subject, htmlContent, textContent);
        } catch (emailError) {
            emailStatus = 'failed';
            failureReason = emailError.message;
            logger.error(`Error enviando email a ${user.email}:`, emailError);
        }

        // Crear el objeto de notificación que se añadirá a cada movimiento
        const notificationDetails = {
            date: new Date(),
            type: 'email',
            success: emailStatus === 'sent',
            details: emailStatus === 'sent' 
                ? `Notificación enviada a ${user.email}`
                : `Error enviando notificación: ${failureReason}`
        };
        
        // Registrar en NotificationLog para cada movimiento
        const notificationLogs = [];
        for (const movement of upcomingMovements) {
            try {
                const log = await NotificationLog.createFromEntity('movement', movement, {
                    method: 'email',
                    status: emailStatus,
                    content: {
                        subject: subject,
                        message: htmlContent,
                        template: 'movement_expiration'
                    },
                    delivery: {
                        recipientEmail: user.email,
                        failureReason: failureReason
                    },
                    config: {
                        daysInAdvance: movement.notificationSettings?.daysInAdvance || globalDaysInAdvance,
                        notifyOnceOnly: movement.notificationSettings?.notifyOnceOnly || userExpirationSettings.notifyOnceOnly
                    },
                    metadata: {
                        source: forceDaily ? 'cron_daily' : 'cron',
                        batchSize: upcomingMovements.length
                    },
                    sentAt: new Date()
                }, user._id);
                
                notificationLogs.push(log);
            } catch (logError) {
                logger.error(`Error creando NotificationLog para movimiento ${movement._id}:`, logError);
            }
        }

        // Usar operación atómica para agregar notificaciones sin duplicados
        const atomicResult = await addNotificationAtomic(
            Movement,
            notifiedMovementIds,
            notificationDetails,
            {
                windowSeconds: 5,
                userSettings: {
                    notifyOnceOnly: userExpirationSettings.notifyOnceOnly,
                    daysInAdvance: userExpirationSettings.daysInAdvance
                }
            }
        );
        
        if (!atomicResult.success) {
            logger.error(`Error agregando notificaciones atómicamente: ${atomicResult.error}`);
        } else {
            logger.info(`Notificaciones agregadas: ${atomicResult.modifiedCount}/${atomicResult.totalCount}, omitidas por duplicados: ${atomicResult.skippedCount}`);
        }

        logger.info(`Notificación de movimientos enviada a ${user.email} para ${upcomingMovements.length} movimientos`);

        return {
            success: true,
            statusCode: 200,
            message: `Se ha enviado una notificación con ${upcomingMovements.length} movimiento(s) próximo(s) a expirar`,
            count: upcomingMovements.length,
            notified: true,
            userId: userId,
            movementIds: notifiedMovementIds,
            forceDaily: forceDaily,
            daysInAdvance: globalDaysInAdvance
        };

    } catch (error) {
        logger.error(`Error al enviar notificaciones de movimientos: ${error.message}`);
        return {
            success: false,
            statusCode: 500,
            message: 'Error al enviar notificaciones de movimientos',
            error: error.message
        };
    }
};


/* Calendar - Events Notifications */
async function sendCalendarNotifications({
    days: requestedDaysInAdvance = null,
    forceDaily = false,
    userId: requestUserId,
    user: reqUser,
    models: { User, Event },
    utilities: { sendEmail, logger, mongoose }
}) {
    try {
        // Obtener userId, ya sea del parámetro directo o del objeto de usuario
        const userId = requestUserId || (reqUser && reqUser._id);

        if (!userId) {
            return {
                success: false,
                statusCode: 400,
                message: 'Se requiere un ID de usuario. Proporcione userId como parámetro o use una sesión autenticada.'
            };
        }

        // Buscar el usuario y verificar sus preferencias
        const user = await User.findById(userId);

        if (!user) {
            return {
                success: false,
                statusCode: 404,
                message: 'Usuario no encontrado'
            };
        }

        // Verificar si las notificaciones por email están habilitadas
        const preferences = user.preferences || {};
        const notifications = preferences.notifications || {};
        const emailEnabled = notifications.channels && notifications.channels.email !== false;
        const userNotificationsEnabled = notifications.user && notifications.user.calendar !== false;

        if (!emailEnabled || !userNotificationsEnabled) {
            return {
                success: true,
                statusCode: 200,
                message: 'Las notificaciones por email para el calendario no están habilitadas para este usuario',
                notified: false
            };
        }

        // Obtener la configuración global de notificaciones de calendario del usuario
        const userCalendarSettings =
            notifications.user &&
                notifications.user.calendarSettings ?
                notifications.user.calendarSettings :
                { notifyOnceOnly: true, daysInAdvance: 5 };

        // Orden de prioridad para daysInAdvance:
        // 1. Parámetro explícito en la llamada a la función
        // 2. Configuración global del usuario
        // 3. Valor por defecto (5)
        const globalDaysInAdvance = requestedDaysInAdvance || userCalendarSettings.daysInAdvance || 5;

        if (globalDaysInAdvance < 1) {
            return {
                success: false,
                statusCode: 400,
                message: 'El número de días debe ser un valor positivo'
            };
        }

        // Calcular las fechas límites para el rango (ignorando la hora)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Utilizamos el valor máximo posible para el futureDate inicial
        // para luego filtrar según la configuración específica de cada evento
        const maxDaysInAdvance = 30; // Valor arbitrario pero razonable como máximo
        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + maxDaysInAdvance);
        futureDate.setHours(23, 59, 59, 999);

        const todayDateString = today.toISOString().split('T')[0];

        // Importamos ObjectId correctamente
        const ObjectId = mongoose.Types.ObjectId;

        // Búsqueda inicial de eventos en el rango máximo de fechas
        let initialEvents = await Event.find({
            userId: new ObjectId(userId),
            start: {
                $gte: today,
                $lte: futureDate
            }
        }).sort({ start: 1 });

        // Ahora filtramos manualmente según la configuración específica de cada evento
        const upcomingEvents = initialEvents.filter(event => {
            // Determinar los días de anticipación para este evento específico
            // Orden de prioridad:
            // 1. Configuración específica del evento
            // 2. Configuración global del usuario
            const eventDaysInAdvance =
                (event.notificationSettings && typeof event.notificationSettings.daysInAdvance === 'number') ?
                    event.notificationSettings.daysInAdvance :
                    globalDaysInAdvance;

            // Calcular la fecha límite específica para este evento
            const eventFutureDate = new Date(today);
            eventFutureDate.setDate(today.getDate() + eventDaysInAdvance);
            eventFutureDate.setHours(23, 59, 59, 999);

            // Verificar si el evento está dentro del rango específico
            const eventDate = new Date(event.start);

            // El evento debe estar dentro del rango de días configurado
            const isInRange = eventDate <= eventFutureDate;

            // Verificar si ya fue notificado (según la configuración de notifyOnceOnly)
            let shouldNotify = true;

            // Determinar si el evento permite múltiples notificaciones
            const notifyOnceOnly =
                (event.notificationSettings && typeof event.notificationSettings.notifyOnceOnly === 'boolean') ?
                    event.notificationSettings.notifyOnceOnly :
                    userCalendarSettings.notifyOnceOnly;

            // Si está configurado para notificar solo una vez y ya tiene notificaciones por email
            if (notifyOnceOnly &&
                event.notifications &&
                event.notifications.some(n => n.type === 'email')) {
                shouldNotify = false;
            }

            // Si permite múltiples notificaciones, verificar si ya se notificó hoy
            if (shouldNotify &&
                !notifyOnceOnly &&
                event.notifications &&
                event.notifications.some(n =>
                    n.type === 'email' &&
                    n.date >= new Date(todayDateString) &&
                    n.date < new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                )) {
                shouldNotify = false;
            }

            // Si estamos forzando notificaciones diarias, ignoramos las verificaciones anteriores
            if (forceDaily) {
                shouldNotify = true;

                // Pero aún así verificamos si ya se notificó hoy
                if (event.notifications &&
                    event.notifications.some(n =>
                        n.type === 'email' &&
                        n.date >= new Date(todayDateString) &&
                        n.date < new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                    )) {
                    shouldNotify = false;
                }
            }

            // El evento debe estar en el rango y cumplir con las reglas de notificación
            return isInRange && shouldNotify;
        });

        if (upcomingEvents.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: 'No hay eventos próximos para notificar o ya fueron notificados según su configuración',
                notified: false,
                forceDaily: forceDaily,
                daysInAdvance: globalDaysInAdvance
            };
        }

        // Usar el template de la base de datos
        const { processEventsData } = require('./eventTemplateProcessor');
        const { getProcessedTemplate } = require('./templateProcessor');
        
        // Crear un array para los IDs de eventos que se notificarán
        const notifiedEventIds = upcomingEvents.map(event => {
            // Log de configuración específica
            const eventSpecificDays = event.notificationSettings?.daysInAdvance || globalDaysInAdvance;
            logger.debug(`Notificación por email para evento ${event._id} (${event.title}) usando configuración de días: ${eventSpecificDays}`);
            return event._id;
        });
        
        // Procesar datos de los eventos
        const templateVariables = processEventsData(upcomingEvents, user);
        
        // Obtener template procesado
        const processedTemplate = await getProcessedTemplate('notification', 'calendar-events', templateVariables);
        
        const subject = processedTemplate.subject;
        const htmlContent = processedTemplate.html;
        const textContent = processedTemplate.text;
        
        logger.info('Usando template de base de datos para notificaciones de calendario');
        
        // Enviar el correo electrónico
        await sendEmail(user.email, subject, htmlContent, textContent);

        // Registrar la notificación enviada en cada evento
        const notificationDetails = {
            date: new Date(),
            type: 'email',
            success: true,
            details: `Notificación enviada a ${user.email}`
        };

        // Inicializar la configuración de notificaciones para eventos sin ella,
        // usando la configuración global del usuario
        await Event.updateMany(
            {
                _id: { $in: notifiedEventIds },
                notificationSettings: { $exists: false }
            },
            {
                $set: {
                    notificationSettings: {
                        notifyOnceOnly: userCalendarSettings.notifyOnceOnly,
                        daysInAdvance: userCalendarSettings.daysInAdvance
                    }
                }
            }
        );

        // Inicializar el array de notificaciones si no existe
        await Event.updateMany(
            {
                _id: { $in: notifiedEventIds },
                notifications: { $exists: false }
            },
            { $set: { notifications: [] } }
        );

        // Añadir la notificación a todos los eventos
        await Event.updateMany(
            { _id: { $in: notifiedEventIds } },
            { $push: { notifications: notificationDetails } }
        );

        logger.info(`Notificación de calendario enviada a ${user.email} para ${upcomingEvents.length} eventos`);

        return {
            success: true,
            statusCode: 200,
            message: `Se ha enviado una notificación con ${upcomingEvents.length} evento(s) próximo(s)`,
            count: upcomingEvents.length,
            notified: true,
            userId: userId,
            eventIds: notifiedEventIds,
            forceDaily: forceDaily,
            daysInAdvance: globalDaysInAdvance
        };

    } catch (error) {
        logger.error(`Error al enviar notificaciones de calendario: ${error.message}`);
        return {
            success: false,
            statusCode: 500,
            message: 'Error al enviar notificaciones de calendario',
            error: error.message
        };
    }
};



/* Tasks Notifications */
async function sendTaskNotifications({
    days: requestedDaysInAdvance = null,
    forceDaily = false,
    userId: requestUserId,
    user: reqUser,
    models: { User, Task },
    utilities: { sendEmail, logger }
}) {
    try {
        // Obtener userId, ya sea del parámetro directo o del objeto de usuario
        const userId = requestUserId || (reqUser && reqUser._id);

        if (!userId) {
            return {
                success: false,
                statusCode: 400,
                message: 'Se requiere un ID de usuario. Proporcione userId como parámetro o use una sesión autenticada.'
            };
        }

        const userObjectId = typeof userId === 'string' ? userId : userId.toString();

        // Buscar el usuario y verificar sus preferencias
        const user = await User.findById(userObjectId);

        if (!user) {
            return {
                success: false,
                statusCode: 404,
                message: 'Usuario no encontrado'
            };
        }

        // Verificar si las notificaciones por email están habilitadas
        const preferences = user.preferences || {};
        const notifications = preferences.notifications || {};
        const emailEnabled = notifications.channels && notifications.channels.email !== false;

        // Para tareas, verificamos taskExpiration (se notifica cuando no sea explícitamente false)
        const taskNotificationsEnabled = notifications.user && notifications.user.taskExpiration !== false;

        if (!emailEnabled || !taskNotificationsEnabled) {
            return {
                success: true,
                statusCode: 200,
                message: 'Las notificaciones por email para tareas no están habilitadas para este usuario',
                notified: false
            };
        }

        // Obtener la configuración específica de notificaciones de tareas del usuario
        const userTaskExpirationSettings =
            notifications.user &&
                notifications.user.taskExpirationSettings ?
                notifications.user.taskExpirationSettings :
                { notifyOnceOnly: true, daysInAdvance: 5 };

        // Orden de prioridad para daysInAdvance:
        // 1. Parámetro explícito en la llamada a la función
        // 2. Configuración de tareas del usuario
        // 3. Valor por defecto (5)
        const globalDaysInAdvance = requestedDaysInAdvance || userTaskExpirationSettings.daysInAdvance || 5;

        if (globalDaysInAdvance < 1) {
            return {
                success: false,
                statusCode: 400,
                message: 'El número de días debe ser un valor positivo'
            };
        }

        // Calcular las fechas límites para el rango (ignorando la hora)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Utilizamos el valor máximo posible para el futureDate inicial
        // para luego filtrar según la configuración específica de cada tarea
        const maxDaysInAdvance = 30; // Valor arbitrario pero razonable como máximo
        const maxFutureDate = new Date(today);
        maxFutureDate.setDate(today.getDate() + maxDaysInAdvance);
        maxFutureDate.setHours(23, 59, 59, 999);

        const todayDateString = today.toISOString().split('T')[0];

        // Búsqueda inicial de tareas en el rango máximo de fechas
        let initialTasks = await Task.find({
            userId: userObjectId,
            status: { $nin: ['completada', 'cancelada'] },
            checked: false,
            dueDate: {
                $gte: today,
                $lte: maxFutureDate
            }
        }).sort({ dueDate: 1 });

        // Ahora filtramos manualmente según la configuración específica de cada tarea
        const upcomingTasks = initialTasks.filter(task => {
            // Determinar los días de anticipación para esta tarea específica
            // Orden de prioridad:
            // 1. Configuración específica de la tarea
            // 2. Configuración global del usuario
            const taskDaysInAdvance =
                (task.notificationSettings && typeof task.notificationSettings.daysInAdvance === 'number') ?
                    task.notificationSettings.daysInAdvance :
                    globalDaysInAdvance;

            // Calcular la fecha límite específica para esta tarea
            const taskFutureDate = new Date(today);
            taskFutureDate.setDate(today.getDate() + taskDaysInAdvance);
            taskFutureDate.setHours(23, 59, 59, 999);

            // Verificar si la tarea está dentro del rango específico
            const dueDate = new Date(task.dueDate);

            // La tarea debe estar dentro del rango de días configurado
            const isInRange = dueDate <= taskFutureDate;

            // Verificar si ya fue notificada (según la configuración de notifyOnceOnly)
            let shouldNotify = true;

            // Determinar si la tarea permite múltiples notificaciones
            const notifyOnceOnly =
                (task.notificationSettings && typeof task.notificationSettings.notifyOnceOnly === 'boolean') ?
                    task.notificationSettings.notifyOnceOnly :
                    userTaskExpirationSettings.notifyOnceOnly;

            // Si está configurada para notificar solo una vez y ya tiene notificaciones por email
            if (notifyOnceOnly &&
                task.notifications &&
                task.notifications.some(n => n.type === 'email')) {
                shouldNotify = false;
            }

            // Si permite múltiples notificaciones, verificar si ya se notificó hoy
            if (shouldNotify &&
                !notifyOnceOnly &&
                task.notifications &&
                task.notifications.some(n =>
                    n.type === 'email' &&
                    n.date >= new Date(todayDateString) &&
                    n.date < new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                )) {
                shouldNotify = false;
            }

            // Si estamos forzando notificaciones diarias, ignoramos las verificaciones anteriores
            if (forceDaily) {
                shouldNotify = true;

                // Pero aún así verificamos si ya se notificó hoy
                if (task.notifications &&
                    task.notifications.some(n =>
                        n.type === 'email' &&
                        n.date >= new Date(todayDateString) &&
                        n.date < new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                    )) {
                    shouldNotify = false;
                }
            }

            // La tarea debe estar en el rango y cumplir con las reglas de notificación
            return isInRange && shouldNotify;
        });

        if (upcomingTasks.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: 'No hay tareas próximas a vencer para notificar o ya fueron notificadas según su configuración',
                notified: false,
                forceDaily: forceDaily,
                daysInAdvance: globalDaysInAdvance
            };
        }

        // Usar el template de la base de datos
        const { processTasksData } = require('./taskTemplateProcessor');
        const { getProcessedTemplate } = require('./templateProcessor');
        
        // Crear un array para los IDs de tareas que se notificarán
        const notifiedTaskIds = upcomingTasks.map(task => task._id);
        
        // Procesar datos de las tareas
        const templateVariables = processTasksData(upcomingTasks, user);
        
        // Obtener template procesado
        const processedTemplate = await getProcessedTemplate('notification', 'tasks-reminder', templateVariables);
        
        const subject = processedTemplate.subject;
        const htmlContent = processedTemplate.html;
        const textContent = processedTemplate.text;
        
        logger.info('Usando template de base de datos para notificaciones de tareas');
        
        // Enviar el correo electrónico (ya no necesita generateEmailTemplate porque el template incluye todo)
        await sendEmail(user.email, subject, htmlContent, textContent);

        // Crear el objeto de notificación que se añadirá a cada tarea
        const notificationDetails = {
            date: new Date(),
            type: 'email',
            success: true,
            details: `Notificación enviada a ${user.email}`
        };

        // Inicializar la configuración de notificaciones para tareas sin ella,
        // usando la configuración de tareas del usuario
        await Task.updateMany(
            {
                _id: { $in: notifiedTaskIds },
                notificationSettings: { $exists: false }
            },
            {
                $set: {
                    notificationSettings: {
                        notifyOnceOnly: userTaskExpirationSettings.notifyOnceOnly,
                        daysInAdvance: userTaskExpirationSettings.daysInAdvance
                    }
                }
            }
        );

        // Inicializar el array de notificaciones si no existe
        await Task.updateMany(
            {
                _id: { $in: notifiedTaskIds },
                notifications: { $exists: false }
            },
            { $set: { notifications: [] } }
        );

        // Añadir la notificación a todas las tareas
        await Task.updateMany(
            { _id: { $in: notifiedTaskIds } },
            { $push: { notifications: notificationDetails } }
        );

        logger.info(`Notificación de tareas enviada a ${user.email} para ${upcomingTasks.length} tareas`);

        return {
            success: true,
            statusCode: 200,
            message: `Se ha enviado una notificación con ${upcomingTasks.length} tarea(s) próxima(s) a vencer`,
            count: upcomingTasks.length,
            notified: true,
            userId: userId,
            taskIds: notifiedTaskIds,
            forceDaily: forceDaily,
            daysInAdvance: globalDaysInAdvance
        };

    } catch (error) {
        logger.error(`Error al enviar notificaciones de tareas: ${error.message}`);
        return {
            success: false,
            statusCode: 500,
            message: 'Error al enviar notificaciones de tareas',
            error: error.message
        };
    }
};



// Funciones auxiliares reutilizables
const helpers = {
    /**
     * Verifica si el usuario tiene habilitadas las notificaciones
     */
    checkUserNotificationsEnabled: (user, notificationType) => {
        const preferences = user.preferences || {};
        const notifications = preferences.notifications || {};
        const browserEnabled = notifications.channels && notifications.channels.browser === true;

        let userNotificationsEnabled = false;

        switch (notificationType) {
            case 'movement':
            case 'task':
                userNotificationsEnabled = notifications.user && notifications.user.expiration !== false;
                break;
            case 'calendar':
                userNotificationsEnabled = notifications.user && notifications.user.calendar !== false;
                break;
            default:
                userNotificationsEnabled = true;
        }

        return browserEnabled && userNotificationsEnabled;
    },

    /**
     * Obtiene la configuración de notificaciones del usuario según el tipo
     */
    getUserNotificationSettings: (user, notificationType) => {
        const notifications = user.preferences?.notifications?.user || {};

        switch (notificationType) {
            case 'movement':
            case 'task':
                return notifications.expirationSettings || { notifyOnceOnly: true, daysInAdvance: 5 };
            case 'calendar':
                return notifications.calendarSettings || { notifyOnceOnly: true, daysInAdvance: 5 };
            default:
                return { notifyOnceOnly: true, daysInAdvance: 5 };
        }
    },

    /**
     * Calcula la fecha futura basada en días de anticipación
     */
    calculateFutureDate: (daysInAdvance, moment) => {
        return moment.utc().startOf('day').add(daysInAdvance, 'days').endOf('day').toDate();
    },

    /**
     * Determina si un elemento debe ser notificado basado en su configuración
     */
    shouldNotifyItem: (item, globalSettings, forceDaily, todayDateString) => {
        // Configuración específica del elemento o global
        const itemDaysInAdvance =
            (item.notificationSettings && typeof item.notificationSettings.daysInAdvance === 'number')
                ? item.notificationSettings.daysInAdvance
                : globalSettings.daysInAdvance;

        const notifyOnceOnly =
            (item.notificationSettings && typeof item.notificationSettings.notifyOnceOnly === 'boolean')
                ? item.notificationSettings.notifyOnceOnly
                : globalSettings.notifyOnceOnly;

        let shouldNotify = true;

        // Si está configurado para notificar solo una vez y ya tiene notificaciones
        if (notifyOnceOnly &&
            item.notifications &&
            item.notifications.some(n => n.type === 'browser')) {
            shouldNotify = false;
        }

        // Si permite múltiples notificaciones, verificar si ya se notificó hoy
        if (shouldNotify &&
            !notifyOnceOnly &&
            item.notifications &&
            item.notifications.some(n => {
                const notificationDate = n.date ? new Date(n.date).toISOString().split('T')[0] : '';
                return n.type === 'browser' && notificationDate === todayDateString;
            })) {
            shouldNotify = false;
        }

        // Si forzamos notificaciones diarias, ignoramos verificaciones anteriores
        if (forceDaily) {
            shouldNotify = true;

            // Pero verificamos si ya se notificó hoy
            if (item.notifications &&
                item.notifications.some(n => {
                    const notificationDate = n.date ? new Date(n.date).toISOString().split('T')[0] : '';
                    return n.type === 'browser' && notificationDate === todayDateString;
                })) {
                shouldNotify = false;
            }
        }

        return { shouldNotify, itemDaysInAdvance };
    },

    /**
     * Configura los datos de la alerta según el tipo y fecha
     */
    getAlertData: (item, type, dateField, today) => {
        const date = new Date(item[dateField]);
        date.setHours(0, 0, 0, 0);

        // Calcula los días de diferencia
        const diffTime = date.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Configuración por tipo de elemento
        const typeConfig = {
            movement: {
                icon: 'TableDocument',
                getTitle: () => {
                    if (diffDays < 0) return { text: 'Movimiento vencido', variant: 'error' };
                    if (diffDays === 0) return { text: 'Movimiento vence hoy', variant: 'warning' };
                    if (diffDays === 1) return { text: 'Movimiento vence mañana', variant: 'warning' };
                    if (diffDays <= 3) return { text: `Movimiento vence en ${diffDays} días`, variant: 'warning' };
                    return { text: 'Movimiento próximo a vencer', variant: 'info' };
                }
            },
            event: {
                icon: 'CalendarRemove',
                getTitle: () => {
                    if (diffDays === 0) return { text: 'Evento hoy', variant: 'warning' };
                    if (diffDays === 1) return { text: 'Evento mañana', variant: 'warning' };
                    if (diffDays <= 3) return { text: `Evento en ${diffDays} días`, variant: 'info' };
                    return { text: 'Evento próximo', variant: 'info' };
                }
            },
            task: {
                icon: 'TaskSquare',
                getTitle: () => {
                    if (diffDays < 0) return { text: 'Tarea vencida', variant: 'error' };
                    if (diffDays === 0) return { text: 'Tarea vence hoy', variant: 'warning' };
                    if (diffDays === 1) return { text: 'Tarea vence mañana', variant: 'warning' };
                    if (diffDays <= 3) return { text: `Tarea vence en ${diffDays} días`, variant: 'warning' };
                    return { text: 'Tarea próxima a vencer', variant: 'info' };
                }
            }
        };

        const config = typeConfig[type];
        const title = config.getTitle();

        // Formatear la fecha para mostrarla en la alerta
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        const formattedDate = `${day}/${month}/${year}`;

        // Crear objeto con los datos de la alerta
        return {
            avatarIcon: config.icon,
            avatarType: 'icon',
            avatarSize: 40,
            primaryText: title.text,
            primaryVariant: title.variant,
            secondaryText: type === 'movement' ? `${item.title} - ${formattedDate}` :
                type === 'event' ? `${item.title} - ${formattedDate}` :
                    item.name || item.title,
            actionText: `Ver ${type === 'movement' ? 'movimiento' : type === 'event' ? 'evento' : 'tarea'}`
        };
    }
};



/* Judicial Movements Notifications */
async function sendJudicialMovementNotifications({
    userId: requestUserId,
    user: reqUser,
    models: { User, JudicialMovement, NotificationLog, Alert },
    utilities: { sendEmail, logger, moment }
}) {
    try {
        // Obtener userId
        const userId = requestUserId || (reqUser && reqUser._id);
        if (!userId) {
            return {
                success: false,
                statusCode: 400,
                message: 'Se requiere un ID de usuario'
            };
        }

        const user = await User.findById(userId);
        if (!user) {
            return {
                success: false,
                statusCode: 404,
                message: 'Usuario no encontrado'
            };
        }

        // Verificar preferencias de notificación
        const preferences = user.preferences || {};
        const notifications = preferences.notifications || {};
        const emailEnabled = notifications.channels && notifications.channels.email !== false;

        if (!emailEnabled) {
            return {
                success: true,
                statusCode: 200,
                message: 'Las notificaciones por email no están habilitadas',
                notified: false
            };
        }

        // Buscar movimientos judiciales pendientes de notificar
        const now = new Date();
        const pendingMovements = await JudicialMovement.find({
            userId,
            notificationStatus: 'pending',
            'notificationSettings.notifyAt': { $lte: now }
        }).sort({ 'movimiento.fecha': -1 });

        if (pendingMovements.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: 'No hay movimientos judiciales pendientes de notificar',
                notified: false
            };
        }

        // Agrupar movimientos por expediente
        const movementsByExpediente = {};
        pendingMovements.forEach(movement => {
            const key = `${movement.expediente.number}/${movement.expediente.year}`;
            if (!movementsByExpediente[key]) {
                movementsByExpediente[key] = {
                    expediente: movement.expediente,
                    movements: []
                };
            }
            movementsByExpediente[key].movements.push(movement);
        });

        // IDs de movimientos notificados
        const notifiedMovementIds = [];
        
        // Recolectar todos los IDs de movimientos
        for (const [key, data] of Object.entries(movementsByExpediente)) {
            data.movements.forEach(movement => {
                // Verificar que el _id existe y es válido
                if (!movement._id) {
                    logger.error(`Movimiento sin _id encontrado:`, JSON.stringify(movement));
                } else {
                    logger.info(`Agregando ID de movimiento: ${movement._id}, userId: ${movement.userId}`);
                    notifiedMovementIds.push(movement._id);
                }
            });
        }

        // Usar el template de la base de datos
        const templateVariables = processJudicialMovementsData(movementsByExpediente, user);
        const processedTemplate = await getProcessedTemplate('notification', 'judicial-movements', templateVariables);
        
        const subject = processedTemplate.subject;
        const htmlContent = processedTemplate.html;
        const textContent = processedTemplate.text;
        
        logger.info('Usando template de base de datos para movimientos judiciales');

        // Enviar email
        let emailStatus = 'sent';
        let failureReason = null;
        
        try {
            await sendEmail(user.email, subject, htmlContent, textContent);
        } catch (emailError) {
            emailStatus = 'failed';
            failureReason = emailError.message;
            logger.error(`Error enviando email de movimientos judiciales a ${user.email}:`, emailError);
        }

        // Actualizar estado de notificación
        const notificationDetails = {
            date: new Date(),
            type: 'email',
            success: emailStatus === 'sent',
            details: emailStatus === 'sent' 
                ? `Notificación enviada a ${user.email}`
                : `Error enviando notificación: ${failureReason}`
        };
        
        logger.info(`Detalles de notificación a guardar:`, JSON.stringify(notificationDetails));

        // Actualizar movimientos notificados
        logger.info(`Actualizando ${notifiedMovementIds.length} movimientos judiciales a estado: ${emailStatus}`);
        
        try {
            // Actualizar estado primero sin notificaciones
            const statusUpdate = await JudicialMovement.updateMany(
                { _id: { $in: notifiedMovementIds } },
                { $set: { notificationStatus: emailStatus } }
            );
            
            logger.info(`Estado actualizado para ${statusUpdate.modifiedCount} movimientos`);
            
            // Luego agregar notificaciones individualmente
            for (const movementId of notifiedMovementIds) {
                try {
                    logger.info(`Intentando actualizar movimiento con ID: ${movementId}`);
                    const movement = await JudicialMovement.findById(movementId);
                    if (movement) {
                        logger.info(`Movimiento encontrado - ID: ${movement._id}, userId: ${movement.userId}`);
                        
                        // Asegurarse de que notifications es un array
                        if (!Array.isArray(movement.notifications)) {
                            movement.notifications = [];
                        }
                        
                        // Crear el objeto de notificación
                        const notificationEntry = {
                            date: new Date(),
                            type: 'email',
                            success: emailStatus === 'sent',
                            details: emailStatus === 'sent' 
                                ? `Notificación enviada a ${user.email}`
                                : `Error enviando notificación: ${failureReason}`
                        };
                        
                        logger.info(`Agregando notificación:`, JSON.stringify(notificationEntry));
                        
                        // Agregar la notificación
                        movement.notifications.push(notificationEntry);
                        
                        // Guardar el documento
                        await movement.save();
                        logger.info(`Notificación agregada exitosamente a movimiento ${movementId}`);
                    } else {
                        logger.warn(`Movimiento no encontrado con ID: ${movementId}`);
                    }
                } catch (err) {
                    logger.error(`Error agregando notificación al movimiento con ID ${movementId}: ${err.message || err}`);
                    logger.error(`Tipo de error: ${err.name}`);
                    if (err.stack) {
                        logger.error(`Stack trace:`, err.stack);
                    }
                }
            }
            
            logger.info(`Proceso de actualización completado`);
        } catch (updateError) {
            logger.error(`Error actualizando movimientos judiciales:`, updateError);
        }

        // Registrar en NotificationLog
        for (const movement of pendingMovements) {
            try {
                await NotificationLog.createFromEntity('judicial_movement', movement, {
                    method: 'email',
                    status: emailStatus,
                    content: {
                        subject: subject,
                        message: htmlContent,
                        template: 'judicial_movement'
                    },
                    delivery: {
                        recipientEmail: user.email,
                        failureReason: failureReason
                    },
                    metadata: {
                        source: 'cron',
                        expediente: `${movement.expediente.number}/${movement.expediente.year}`
                    },
                    sentAt: new Date()
                }, user._id);
            } catch (logError) {
                logger.error(`Error creando NotificationLog para movimiento judicial ${movement._id}:`, logError);
            }
        }

        // Enviar notificaciones de navegador si están habilitadas
        const browserEnabled = notifications.channels && notifications.channels.browser === true;
        if (browserEnabled && pendingMovements.length > 0) {
            try {
                const { sendJudicialMovementBrowserAlerts } = require('./browser');
                const browserResult = await sendJudicialMovementBrowserAlerts({
                    userId: userId,
                    models: { User, JudicialMovement, Alert },
                    utilities: { logger, mongoose: require('mongoose'), moment }
                });
                
                if (browserResult.success && browserResult.notified) {
                    logger.info(`Notificaciones de navegador enviadas para ${browserResult.count} movimientos judiciales`);
                    
                    // Actualizar notificaciones en los movimientos para indicar que se enviaron por browser
                    for (const movementId of notifiedMovementIds) {
                        try {
                            const movement = await JudicialMovement.findById(movementId);
                            if (movement) {
                                // Asegurarse de que notifications es un array
                                if (!Array.isArray(movement.notifications)) {
                                    movement.notifications = [];
                                }
                                
                                movement.notifications.push({
                                    date: new Date(),
                                    type: 'browser',
                                    success: true,
                                    details: 'Alerta creada en el navegador'
                                });
                                await movement.save();
                            }
                        } catch (err) {
                            logger.error(`Error agregando notificación browser a ${movementId}: ${err.message}`);
                        }
                    }
                } else {
                    logger.warn(`No se pudieron enviar notificaciones de navegador: ${browserResult.message}`);
                }
            } catch (browserError) {
                logger.error(`Error enviando notificaciones de navegador para movimientos judiciales: ${browserError.message}`);
            }
        }

        logger.info(`Notificación de movimientos judiciales enviada a ${user.email} para ${pendingMovements.length} movimientos`);

        return {
            success: true,
            statusCode: 200,
            message: `Se notificaron ${pendingMovements.length} movimientos judiciales`,
            count: pendingMovements.length,
            notified: true,
            userId: userId,
            movementIds: notifiedMovementIds
        };

    } catch (error) {
        logger.error(`Error al enviar notificaciones de movimientos judiciales: ${error.message}`);
        return {
            success: false,
            statusCode: 500,
            message: 'Error al enviar notificaciones',
            error: error.message
        };
    }
};

/**
 * Envía notificaciones de inactividad de folders (caducidad y prescripción)
 * @param {Object} params - Parámetros de la función
 * @returns {Object} - Resultado de la operación
 */
async function sendFolderInactivityNotifications({
    userId: requestUserId,
    user: reqUser,
    models: { User, Folder },
    utilities: { sendEmail, logger, moment }
}) {
    try {
        // Obtener userId
        const userId = requestUserId || (reqUser && reqUser._id);
        if (!userId) {
            return {
                success: false,
                statusCode: 400,
                message: 'Se requiere un ID de usuario'
            };
        }

        const user = await User.findById(userId);
        if (!user) {
            return {
                success: false,
                statusCode: 404,
                message: 'Usuario no encontrado'
            };
        }

        // Verificar preferencias de notificación
        const preferences = user.preferences || {};
        const notifications = preferences.notifications || {};
        const emailEnabled = notifications.channels && notifications.channels.email !== false;

        // Verificar si inactivity está habilitado (no debe ser false)
        const inactivityEnabled = notifications.user && notifications.user.inactivity !== false;

        if (!emailEnabled || !inactivityEnabled) {
            return {
                success: true,
                statusCode: 200,
                message: 'Las notificaciones de inactividad no están habilitadas para este usuario',
                notified: false
            };
        }

        // Obtener configuración de inactividad del usuario
        const inactivitySettings = notifications.user?.inactivitySettings || {
            daysInAdvance: 5,
            caducityDays: 180,
            prescriptionDays: 730,
            notifyOnceOnly: true
        };

        const { daysInAdvance, caducityDays, prescriptionDays, notifyOnceOnly } = inactivitySettings;

        // Buscar folders del usuario que no estén archivados ni cerrados
        const folders = await Folder.find({
            userId: userId,
            archived: false,
            status: { $ne: 'Cerrada' }
        });

        if (folders.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: 'No hay folders activos para este usuario',
                notified: false
            };
        }

        // Importar funciones del template processor
        const { getMostRecentDate, calculateDaysRemaining, processCaducityData, processPrescriptionData } = require('./folderTemplateProcessor');
        const { getProcessedTemplate } = require('./templateProcessor');

        const today = moment.utc().startOf('day');
        const todayDateString = today.format('YYYY-MM-DD');

        // Arrays para almacenar folders con alertas
        const caducityFolders = [];
        const prescriptionFolders = [];

        // Evaluar cada folder
        for (const folder of folders) {
            const lastActivityDate = getMostRecentDate(folder);

            if (!lastActivityDate) {
                logger.debug(`Folder ${folder._id} no tiene fechas de actividad, omitiendo`);
                continue;
            }

            // Calcular días restantes para caducidad y prescripción
            const daysUntilCaducity = calculateDaysRemaining(lastActivityDate, caducityDays);
            const daysUntilPrescription = calculateDaysRemaining(lastActivityDate, prescriptionDays);

            // Lógica para determinar si debe notificarse
            // notifyOnceOnly = true: notificar solo cuando días restantes === daysInAdvance
            // notifyOnceOnly = false: notificar cuando días restantes <= daysInAdvance y > 0, o === 0

            // Verificar alerta de caducidad
            let shouldNotifyCaducity = false;
            if (notifyOnceOnly) {
                // Solo notificar exactamente cuando faltan daysInAdvance días
                shouldNotifyCaducity = daysUntilCaducity === daysInAdvance;
            } else {
                // Notificar en todo el rango desde daysInAdvance hasta 0
                shouldNotifyCaducity = daysUntilCaducity >= 0 && daysUntilCaducity <= daysInAdvance;
            }

            // Verificar si ya fue notificado hoy (para caducidad)
            if (shouldNotifyCaducity && folder.notifications) {
                const alreadyNotifiedToday = folder.notifications.some(n => {
                    const notificationDate = n.date ? moment.utc(n.date).format('YYYY-MM-DD') : '';
                    return n.type === 'email' && n.alertType === 'caducity' && notificationDate === todayDateString;
                });
                if (alreadyNotifiedToday) {
                    shouldNotifyCaducity = false;
                }
            }

            if (shouldNotifyCaducity) {
                caducityFolders.push(folder);
            }

            // Verificar alerta de prescripción
            let shouldNotifyPrescription = false;
            if (notifyOnceOnly) {
                shouldNotifyPrescription = daysUntilPrescription === daysInAdvance;
            } else {
                shouldNotifyPrescription = daysUntilPrescription >= 0 && daysUntilPrescription <= daysInAdvance;
            }

            // Verificar si ya fue notificado hoy (para prescripción)
            if (shouldNotifyPrescription && folder.notifications) {
                const alreadyNotifiedToday = folder.notifications.some(n => {
                    const notificationDate = n.date ? moment.utc(n.date).format('YYYY-MM-DD') : '';
                    return n.type === 'email' && n.alertType === 'prescription' && notificationDate === todayDateString;
                });
                if (alreadyNotifiedToday) {
                    shouldNotifyPrescription = false;
                }
            }

            if (shouldNotifyPrescription) {
                prescriptionFolders.push(folder);
            }
        }

        let caducityResult = { notified: false, count: 0 };
        let prescriptionResult = { notified: false, count: 0 };

        // Enviar notificación de caducidad si hay folders
        if (caducityFolders.length > 0) {
            try {
                const templateVariables = processCaducityData(caducityFolders, user, inactivitySettings);
                const processedTemplate = await getProcessedTemplate('notification', 'folder-caducity', templateVariables);

                await sendEmail(user.email, processedTemplate.subject, processedTemplate.html, processedTemplate.text);

                // Registrar notificación en cada folder
                const notificationDetails = {
                    date: new Date(),
                    type: 'email',
                    alertType: 'caducity',
                    success: true,
                    details: `Notificación de caducidad enviada a ${user.email}`
                };

                for (const folder of caducityFolders) {
                    await Folder.updateOne(
                        { _id: folder._id },
                        { $push: { notifications: notificationDetails } }
                    );
                }

                caducityResult = { notified: true, count: caducityFolders.length };
                logger.info(`Notificación de caducidad enviada a ${user.email} para ${caducityFolders.length} carpetas`);

            } catch (error) {
                logger.error(`Error enviando notificación de caducidad a ${user.email}: ${error.message}`);
            }
        }

        // Enviar notificación de prescripción si hay folders
        if (prescriptionFolders.length > 0) {
            try {
                const templateVariables = processPrescriptionData(prescriptionFolders, user, inactivitySettings);
                const processedTemplate = await getProcessedTemplate('notification', 'folder-prescription', templateVariables);

                await sendEmail(user.email, processedTemplate.subject, processedTemplate.html, processedTemplate.text);

                // Registrar notificación en cada folder
                const notificationDetails = {
                    date: new Date(),
                    type: 'email',
                    alertType: 'prescription',
                    success: true,
                    details: `Notificación de prescripción enviada a ${user.email}`
                };

                for (const folder of prescriptionFolders) {
                    await Folder.updateOne(
                        { _id: folder._id },
                        { $push: { notifications: notificationDetails } }
                    );
                }

                prescriptionResult = { notified: true, count: prescriptionFolders.length };
                logger.info(`Notificación de prescripción enviada a ${user.email} para ${prescriptionFolders.length} carpetas`);

            } catch (error) {
                logger.error(`Error enviando notificación de prescripción a ${user.email}: ${error.message}`);
            }
        }

        const totalNotified = caducityResult.count + prescriptionResult.count;

        if (totalNotified === 0) {
            return {
                success: true,
                statusCode: 200,
                message: 'No hay carpetas con alertas de inactividad para notificar',
                notified: false
            };
        }

        return {
            success: true,
            statusCode: 200,
            message: `Notificaciones de inactividad enviadas: ${caducityResult.count} caducidad, ${prescriptionResult.count} prescripción`,
            notified: true,
            caducity: caducityResult,
            prescription: prescriptionResult,
            userId: userId
        };

    } catch (error) {
        logger.error(`Error al enviar notificaciones de inactividad: ${error.message}`);
        return {
            success: false,
            statusCode: 500,
            message: 'Error al enviar notificaciones de inactividad',
            error: error.message
        };
    }
}

module.exports = {
    sendCalendarNotifications,
    sendTaskNotifications,
    sendMovementNotifications,
    sendJudicialMovementNotifications,
    sendFolderInactivityNotifications,
};