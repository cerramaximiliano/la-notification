const mongoose = require("mongoose");
const moment = require("moment");
const logger = require("../config/logger");
const { sendEmail } = require("./email");
const { User, Event, Task, Movement, Alert, NotificationLog } = require("../models");
const { addNotificationAtomic } = require("./notificationHelper");

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

        // Crear el contenido del correo electrónico
        const subject = `Law||Analytics: Tienes ${upcomingMovements.length} movimiento(s) próximo(s) a expirar`;

        // Construir el contenido interno del email
        let htmlContent = `
          <h2 style="color: #2563eb; margin-bottom: 20px; font-size: 24px; line-height: 1.3;">Recordatorio de movimientos próximos a expirar</h2>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Hola ${user.name || user.email || 'Usuario'},</p>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Te recordamos que tienes los siguientes movimientos próximos a expirar:</p>
          <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            <thead>
              <tr style="background-color: #f0f4f8;">
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Fecha de expiración</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Título</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Tipo de movimiento</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Descripción</th>
              </tr>
            </thead>
            <tbody>
        `;

        // Contenido en texto plano para alternativa sin formato HTML
        let textContent = `Recordatorio de movimientos próximos a expirar\n\n`;
        textContent += `Hola ${user.name || user.email || 'Usuario'},\n\n`;
        textContent += `Te recordamos que tienes los siguientes movimientos próximos a expirar:\n\n`;

        // Crear un array para los IDs de movimientos que se notificarán
        const notifiedMovementIds = [];

        // Agregar cada movimiento a la tabla HTML y al texto plano
        upcomingMovements.forEach(movement => {
            // Convertir fecha a UTC ignorando la zona horaria
            const expDate = moment.utc(movement.dateExpiration);

            // Formatear fecha en DD/MM/YYYY usando UTC
            const formattedExpirationDate = expDate.format('DD/MM/YYYY');

            // Guardar el ID para actualizar después
            notifiedMovementIds.push(movement._id);

            // Obtener la configuración específica utilizada
            const movementSpecificDays = movement.notificationSettings?.daysInAdvance || globalDaysInAdvance;
            logger.debug(`Notificación por email para movimiento ${movement._id} (${movement.title}) usando configuración de días: ${movementSpecificDays}`);

            // Formato HTML
            htmlContent += `
            <tr>
              <td style="border: 1px solid #e5e7eb; padding: 12px; color: #4b5563;">${formattedExpirationDate}</td>
              <td style="border: 1px solid #e5e7eb; padding: 12px; color: #4b5563;">${movement.title}</td>
              <td style="border: 1px solid #e5e7eb; padding: 12px; color: #4b5563;">${movement.movement}</td>
              <td style="border: 1px solid #e5e7eb; padding: 12px; color: #4b5563;">${movement.description || '-'}</td>
            </tr>
          `;

            // Formato texto plano
            textContent += `- ${formattedExpirationDate}: ${movement.title} (Tipo: ${movement.movement})\n`;
            if (movement.description) textContent += `  ${movement.description}\n`;
        });

        htmlContent += `
            </tbody>
          </table>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Puedes ver todos los detalles en la sección de movimientos de tu cuenta de Law||Analytics.</p>
          <p style="font-size: 16px; line-height: 1.6;">Saludos,<br>El equipo de Law||Analytics</p>
        `;

        textContent += `\nPuedes ver todos los detalles en la sección de movimientos de tu cuenta de Law||Analytics.\n\n`;
        textContent += `Saludos,\nEl equipo de Law||Analytics`;

        // Enviar el correo electrónico
        let emailStatus = 'sent';
        let failureReason = null;
        
        try {
            const fullHtmlContent = generateEmailTemplate(subject, htmlContent);
            await sendEmail(user.email, subject, fullHtmlContent, textContent);
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

        // Crear el contenido del correo electrónico
        const subject = `Law||Analytics: Tienes ${upcomingEvents.length} evento(s) próximo(s) en tu calendario`;

        // Construir el contenido interno del email
        let htmlContent = `
          <h2 style="color: #2563eb; margin-bottom: 20px; font-size: 24px; line-height: 1.3;">Recordatorio de eventos próximos</h2>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Hola ${user.name || user.email || 'Usuario'},</p>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Te recordamos que tienes los siguientes eventos programados en tu calendario:</p>
          <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            <thead>
              <tr style="background-color: #f0f4f8;">
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Fecha</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Título</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Descripción</th>
              </tr>
            </thead>
            <tbody>
        `;

        // Contenido en texto plano para alternativa sin formato HTML
        let textContent = `Recordatorio de eventos próximos\n\n`;
        textContent += `Hola ${user.name || user.email || 'Usuario'},\n\n`;
        textContent += `Te recordamos que tienes los siguientes eventos programados en tu calendario:\n\n`;

        // Crear un array para los IDs de eventos que se notificarán
        const notifiedEventIds = [];

        // Agregar cada evento a la tabla HTML y al texto plano
        upcomingEvents.forEach(event => {
            // Extraer directamente los componentes de la fecha guardada
            const startDate = new Date(event.start);

            // Formato de fecha: DD/MM/YYYY
            const day = startDate.getUTCDate().toString().padStart(2, '0');
            const month = (startDate.getUTCMonth() + 1).toString().padStart(2, '0');
            const year = startDate.getUTCFullYear();

            // Formato de hora: HH:MM
            const hour = startDate.getUTCHours().toString().padStart(2, '0');
            const minute = startDate.getUTCMinutes().toString().padStart(2, '0');

            // Determinar AM/PM
            const ampm = hour >= 12 ? 'p. m.' : 'a. m.';

            // Convertir a formato 12 horas
            const hour12 = (hour % 12) || 12;

            // Crear cadenas formateadas
            const formattedDate = `${day}/${month}/${year}`;
            const formattedTime = `${hour12}:${minute} ${ampm}`;

            // Guardar el ID para actualizar después
            notifiedEventIds.push(event._id);

            // Obtener la configuración específica utilizada
            const eventSpecificDays = event.notificationSettings?.daysInAdvance || globalDaysInAdvance;
            logger.debug(`Notificación por email para evento ${event._id} (${event.title}) usando configuración de días: ${eventSpecificDays}`);

            // Formato HTML
            htmlContent += `
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px;">${formattedDate} ${event.allDay ? '(Todo el día)' : formattedTime}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${event.title}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${event.description || '-'}</td>
            </tr>
          `;

            // Formato texto plano
            textContent += `- ${formattedDate} ${event.allDay ? '(Todo el día)' : formattedTime}: ${event.title}\n`;
            if (event.description) textContent += `  ${event.description}\n`;
        });

        htmlContent += `
            </tbody>
          </table>
          <p>Puedes ver todos los detalles en la sección de calendario de tu cuenta de Law||Analytics.</p>
          <p>Saludos,<br>El equipo de Law||Analytics</p>
        `;

        textContent += `\nPuedes ver todos los detalles en la sección de calendario de tu cuenta de Law||Analytics.\n\n`;
        textContent += `Saludos,\nEl equipo de Law||Analytics`;

        // Enviar el correo electrónico
        const fullHtmlContent = generateEmailTemplate(subject, htmlContent);
        await sendEmail(user.email, subject, fullHtmlContent, textContent);

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
        const userNotificationsEnabled = notifications.user && notifications.user.expiration !== false;

        if (!emailEnabled || !userNotificationsEnabled) {
            return {
                success: true,
                statusCode: 200,
                message: 'Las notificaciones por email para tareas no están habilitadas para este usuario',
                notified: false
            };
        }

        // Obtener la configuración global de notificaciones de tareas del usuario
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
                    userExpirationSettings.notifyOnceOnly;

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

        // Crear el contenido del correo electrónico
        const subject = `Law||Analytics: Tienes ${upcomingTasks.length} tarea(s) próxima(s) a vencer`;

        // Construir el contenido interno del email
        let htmlContent = `
          <h2 style="color: #2563eb; margin-bottom: 20px; font-size: 24px; line-height: 1.3;">Recordatorio de tareas próximas a vencer</h2>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Hola ${user.name || user.email || 'Usuario'},</p>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Te recordamos que tienes las siguientes tareas próximas a vencer:</p>
          <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
            <thead>
              <tr style="background-color: #f0f4f8;">
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Fecha de vencimiento</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Tarea</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Prioridad</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; color: #374151;">Estado</th>
              </tr>
            </thead>
            <tbody>
        `;

        // Contenido en texto plano para alternativa sin formato HTML
        let textContent = `Recordatorio de tareas próximas a vencer\n\n`;
        textContent += `Hola ${user.name || user.email || 'Usuario'},\n\n`;
        textContent += `Te recordamos que tienes las siguientes tareas próximas a vencer:\n\n`;

        // Crear un array para los IDs de tareas que se notificarán
        const notifiedTaskIds = [];

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

        // Agregar cada tarea a la tabla HTML y al texto plano
        upcomingTasks.forEach(task => {
            // Extraer directamente los componentes de la fecha guardada
            const dueDate = new Date(task.dueDate);

            // Formato de fecha: DD/MM/YYYY
            const day = dueDate.getUTCDate().toString().padStart(2, '0');
            const month = (dueDate.getUTCMonth() + 1).toString().padStart(2, '0');
            const year = dueDate.getUTCFullYear();

            // Obtener la hora original si existe, o usar medianoche por defecto
            let formattedTime = "";
            if (task.dueTime) {
                // Si tenemos dueTime guardado, lo usamos
                const [hours, minutes] = task.dueTime.split(':');
                const hour12 = (parseInt(hours) % 12) || 12;
                const ampm = parseInt(hours) >= 12 ? 'p. m.' : 'a. m.';
                formattedTime = `${hour12}:${minutes} ${ampm}`;
            } else {
                // Si no hay dueTime, extraemos la hora de dueDate
                const hour = dueDate.getUTCHours().toString().padStart(2, '0');
                const minute = dueDate.getUTCMinutes().toString().padStart(2, '0');
                const ampm = parseInt(hour) >= 12 ? 'p. m.' : 'a. m.';
                const hour12 = (parseInt(hour) % 12) || 12;
                formattedTime = `${hour12}:${minute} ${ampm}`;
            }

            // Crear cadenas formateadas
            const formattedDate = `${day}/${month}/${year}`;

            // Guardar el ID para actualizar después
            notifiedTaskIds.push(task._id);

            // Obtener la configuración específica utilizada
            const taskSpecificDays = task.notificationSettings?.daysInAdvance || globalDaysInAdvance;
            logger.debug(`Notificación por email para tarea ${task._id} (${task.name}) usando configuración de días: ${taskSpecificDays}`);

            // Obtener color y texto para la prioridad
            const priorityColor = getPriorityColor(task.priority);
            const statusText = getStatusText(task.status);

            // Formato HTML
            htmlContent += `
            <tr>
              <td style="border: 1px solid #e5e7eb; padding: 12px; color: #4b5563;">${formattedDate}</td>
              <td style="border: 1px solid #e5e7eb; padding: 12px; color: #4b5563;">${task.name}</td>
              <td style="border: 1px solid #e5e7eb; padding: 12px; ${priorityColor}">${task.priority.toUpperCase()}</td>
              <td style="border: 1px solid #e5e7eb; padding: 12px; color: #4b5563;">${statusText}</td>
            </tr>
          `;

            // Formato texto plano
            textContent += `- ${formattedDate} ${formattedTime}: ${task.name} (Prioridad: ${task.priority.toUpperCase()}, Estado: ${statusText})\n`;
            if (task.description) textContent += `  ${task.description}\n`;
        });

        htmlContent += `
            </tbody>
          </table>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Puedes ver todos los detalles en la sección de tareas de tu cuenta de Law||Analytics.</p>
          <p style="font-size: 16px; line-height: 1.6;">Saludos,<br>El equipo de Law||Analytics</p>
        `;

        textContent += `\nPuedes ver todos los detalles en la sección de tareas de tu cuenta de Law||Analytics.\n\n`;
        textContent += `Saludos,\nEl equipo de Law||Analytics`;

        // Enviar el correo electrónico
        const fullHtmlContent = generateEmailTemplate(subject, htmlContent);
        await sendEmail(user.email, subject, fullHtmlContent, textContent);

        // Crear el objeto de notificación que se añadirá a cada tarea
        const notificationDetails = {
            date: new Date(),
            type: 'email',
            success: true,
            details: `Notificación enviada a ${user.email}`
        };

        // Inicializar la configuración de notificaciones para tareas sin ella,
        // usando la configuración global del usuario
        await Task.updateMany(
            {
                _id: { $in: notifiedTaskIds },
                notificationSettings: { $exists: false }
            },
            {
                $set: {
                    notificationSettings: {
                        notifyOnceOnly: userExpirationSettings.notifyOnceOnly,
                        daysInAdvance: userExpirationSettings.daysInAdvance
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
    models: { User, JudicialMovement, NotificationLog },
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

        // Crear contenido del email
        const subject = `Law||Analytics: Nuevos movimientos en ${Object.keys(movementsByExpediente).length} expediente(s)`;
        
        let htmlContent = `
          <h2 style="color: #2563eb; margin-bottom: 20px; font-size: 24px; line-height: 1.3;">Nuevos movimientos judiciales</h2>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Hola ${user.name || user.email || 'Usuario'},</p>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Se han registrado nuevos movimientos en tus expedientes:</p>
        `;

        let textContent = `Nuevos movimientos judiciales\n\n`;
        textContent += `Hola ${user.name || user.email || 'Usuario'},\n\n`;
        textContent += `Se han registrado nuevos movimientos en tus expedientes:\n\n`;

        // IDs de movimientos notificados
        const notifiedMovementIds = [];

        // Agregar información de cada expediente
        for (const [key, data] of Object.entries(movementsByExpediente)) {
            const { expediente, movements } = data;
            
            htmlContent += `
              <div style="margin-bottom: 30px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px;">
                <h3 style="color: #1f2937; margin-bottom: 15px; font-size: 18px;">
                  Expediente ${expediente.number}/${expediente.year} - ${expediente.fuero}
                </h3>
                <p style="font-size: 14px; color: #6b7280; margin-bottom: 15px;">
                  <strong>Carátula:</strong> ${expediente.caratula}
                </p>
                <table style="border-collapse: collapse; width: 100%; margin-bottom: 15px;">
                  <thead>
                    <tr style="background-color: #f0f4f8;">
                      <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left; font-weight: 600; color: #374151;">Fecha</th>
                      <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left; font-weight: 600; color: #374151;">Tipo</th>
                      <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left; font-weight: 600; color: #374151;">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
            `;

            textContent += `\nExpediente ${expediente.number}/${expediente.year} - ${expediente.fuero}\n`;
            textContent += `Carátula: ${expediente.caratula}\n\n`;

            // Agregar cada movimiento
            movements.forEach(movement => {
                const fecha = moment(movement.movimiento.fecha).format('DD/MM/YYYY');
                notifiedMovementIds.push(movement._id);

                htmlContent += `
                  <tr>
                    <td style="border: 1px solid #e5e7eb; padding: 10px; color: #4b5563;">${fecha}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 10px; color: #4b5563;">${movement.movimiento.tipo}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 10px; color: #4b5563;">
                      ${movement.movimiento.detalle}
                      ${movement.movimiento.url ? `<br><a href="${movement.movimiento.url}" style="color: #2563eb; font-size: 12px; text-decoration: none;">Ver documento</a>` : ''}
                    </td>
                  </tr>
                `;

                textContent += `- ${fecha}: ${movement.movimiento.tipo} - ${movement.movimiento.detalle}\n`;
            });

            htmlContent += `
                  </tbody>
                </table>
              </div>
            `;
        }

        htmlContent += `
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
            Puedes ver todos los detalles en la sección de expedientes de tu cuenta de Law||Analytics.
          </p>
          <p style="font-size: 16px; line-height: 1.6;">Saludos,<br>El equipo de Law||Analytics</p>
        `;

        textContent += `\nPuedes ver todos los detalles en la sección de expedientes de tu cuenta de Law||Analytics.\n\n`;
        textContent += `Saludos,\nEl equipo de Law||Analytics`;

        // Enviar email
        let emailStatus = 'sent';
        let failureReason = null;
        
        try {
            const fullHtmlContent = generateEmailTemplate(subject, htmlContent);
            await sendEmail(user.email, subject, fullHtmlContent, textContent);
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

        // Actualizar movimientos notificados
        logger.info(`Actualizando ${notifiedMovementIds.length} movimientos judiciales a estado: ${emailStatus}`);
        const updateResult = await JudicialMovement.updateMany(
            { _id: { $in: notifiedMovementIds } },
            {
                $set: { 
                    notificationStatus: emailStatus === 'sent' ? 'sent' : 'failed' 
                },
                $push: { 
                    notifications: notificationDetails 
                }
            }
        );
        logger.info(`Resultado actualización: ${updateResult.modifiedCount} de ${updateResult.matchedCount} documentos actualizados`);

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

module.exports = {
    sendCalendarNotifications,
    sendTaskNotifications,
    sendMovementNotifications,
    sendJudicialMovementNotifications,
};