const mongoose = require("mongoose");
const moment = require("moment");
const logger = require("../config/logger");
const { sendEmail } = require("./email");
const User = require("../models/User");
const Event = require("../models/Event");
const Task = require("../models/Task");
const Movement = require('../models/Movement');
const Alert = require("../models/Alert");


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

        // Construir una tabla HTML con los movimientos
        let htmlContent = `
          <h2>Recordatorio de movimientos próximos a expirar</h2>
          <p>Hola ${user.firstName || 'Usuario'},</p>
          <p>Te recordamos que tienes los siguientes movimientos próximos a expirar:</p>
          <table style="border-collapse: collapse; width: 100%;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Fecha de expiración</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Título</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Tipo de movimiento</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Descripción</th>
              </tr>
            </thead>
            <tbody>
        `;

        // Contenido en texto plano para alternativa sin formato HTML
        let textContent = `Recordatorio de movimientos próximos a expirar\n\n`;
        textContent += `Hola ${user.firstName || 'Usuario'},\n\n`;
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
              <td style="border: 1px solid #ddd; padding: 8px;">${formattedExpirationDate}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${movement.title}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${movement.movement}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${movement.description || '-'}</td>
            </tr>
          `;

            // Formato texto plano
            textContent += `- ${formattedExpirationDate}: ${movement.title} (Tipo: ${movement.movement})\n`;
            if (movement.description) textContent += `  ${movement.description}\n`;
        });

        htmlContent += `
            </tbody>
          </table>
          <p>Puedes ver todos los detalles en la sección de movimientos de tu cuenta de Law||Analytics.</p>
          <p>Saludos,<br>El equipo de Law||Analytics</p>
        `;

        textContent += `\nPuedes ver todos los detalles en la sección de movimientos de tu cuenta de Law||Analytics.\n\n`;
        textContent += `Saludos,\nEl equipo de Law||Analytics`;

        // Enviar el correo electrónico
        await sendEmail(user.email, subject, htmlContent, textContent);

        // Crear el objeto de notificación que se añadirá a cada movimiento
        const notificationDetails = {
            date: new Date(),
            type: 'email',
            success: true,
            details: `Notificación enviada a ${user.email}`
        };

        // Inicializar la configuración de notificaciones para movimientos sin ella,
        // usando la configuración global del usuario
        await Movement.updateMany(
            {
                _id: { $in: notifiedMovementIds },
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
        await Movement.updateMany(
            {
                _id: { $in: notifiedMovementIds },
                notifications: { $exists: false }
            },
            { $set: { notifications: [] } }
        );

        // Añadir la notificación a todos los movimientos
        await Movement.updateMany(
            { _id: { $in: notifiedMovementIds } },
            { $push: { notifications: notificationDetails } }
        );

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

        // Construir una tabla HTML con los eventos
        let htmlContent = `
          <h2>Recordatorio de eventos próximos</h2>
          <p>Hola ${user.firstName || 'Usuario'},</p>
          <p>Te recordamos que tienes los siguientes eventos programados en tu calendario:</p>
          <table style="border-collapse: collapse; width: 100%;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Fecha</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Título</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Descripción</th>
              </tr>
            </thead>
            <tbody>
        `;

        // Contenido en texto plano para alternativa sin formato HTML
        let textContent = `Recordatorio de eventos próximos\n\n`;
        textContent += `Hola ${user.firstName || 'Usuario'},\n\n`;
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

        // Construir una tabla HTML con las tareas
        let htmlContent = `
          <h2>Recordatorio de tareas próximas a vencer</h2>
          <p>Hola ${user.firstName || 'Usuario'},</p>
          <p>Te recordamos que tienes las siguientes tareas próximas a vencer:</p>
          <table style="border-collapse: collapse; width: 100%;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Fecha de vencimiento</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Tarea</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Prioridad</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Estado</th>
              </tr>
            </thead>
            <tbody>
        `;

        // Contenido en texto plano para alternativa sin formato HTML
        let textContent = `Recordatorio de tareas próximas a vencer\n\n`;
        textContent += `Hola ${user.firstName || 'Usuario'},\n\n`;
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
              <td style="border: 1px solid #ddd; padding: 8px;">${formattedDate}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${task.name}</td>
              <td style="border: 1px solid #ddd; padding: 8px; ${priorityColor}">${task.priority.toUpperCase()}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${statusText}</td>
            </tr>
          `;

            // Formato texto plano
            textContent += `- ${formattedDate} ${formattedTime}: ${task.name} (Prioridad: ${task.priority.toUpperCase()}, Estado: ${statusText})\n`;
            if (task.description) textContent += `  ${task.description}\n`;
        });

        htmlContent += `
            </tbody>
          </table>
          <p>Puedes ver todos los detalles en la sección de tareas de tu cuenta de Law||Analytics.</p>
          <p>Saludos,<br>El equipo de Law||Analytics</p>
        `;

        textContent += `\nPuedes ver todos los detalles en la sección de tareas de tu cuenta de Law||Analytics.\n\n`;
        textContent += `Saludos,\nEl equipo de Law||Analytics`;

        // Enviar el correo electrónico
        await sendEmail(user.email, subject, htmlContent, textContent);

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



module.exports = {
    sendCalendarNotifications,
    sendTaskNotifications,
    sendMovementNotifications,
};