const mongoose = require("mongoose");
const moment = require("moment");
const logger = require("../config/logger");
const { sendEmail } = require("./email");
const User = require("../models/User");
const Event = require("../models/Event");
const Task = require("../models/Task");
const Movement = require('../models/Movement');

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

        // Usar el parámetro days del request si se proporcionó, o la configuración del usuario
        const daysInAdvance = requestedDaysInAdvance || userExpirationSettings.daysInAdvance || 5;

        if (daysInAdvance < 1) {
            return {
                success: false,
                statusCode: 400,
                message: 'El número de días debe ser un valor positivo'
            };
        }

        // Calcular las fechas límites para el rango usando UTC
        const today = moment.utc().startOf('day').toDate();

        const futureDate = moment.utc().startOf('day').add(daysInAdvance, 'days').endOf('day').toDate();

        const todayDateString = moment.utc().format('YYYY-MM-DD');

        const ObjectId = mongoose.Types.ObjectId;
        // Construir la consulta principal para movimientos próximos a expirar
        let query = {
            // Filtrar por usuario
            userId: new ObjectId(userObjectId),

            // Asegurarse de que haya un dateExpiration
            dateExpiration: {
                $exists: true,
                $ne: null,
                // Ahora que dateExpiration es de tipo Date, podemos comparar directamente con objetos Date
                $gte: today,
                $lte: futureDate
            }
        };

        // Si no estamos forzando notificaciones diarias, añadir filtros para notificaciones
        if (!forceDaily) {
            query.$or = [
                // Movimientos sin notificaciones (nunca notificados)
                { notifications: { $exists: false } },
                { notifications: { $size: 0 } },

                // Movimientos sin configuración propia (usan la configuración global)
                // Y la configuración global permite múltiples notificaciones
                // Y no han sido notificados hoy
                {
                    'notificationSettings.notifyOnceOnly': { $exists: false },
                    $and: [
                        {
                            $or: [
                                // Si la configuración global permite múltiples notificaciones
                                { $expr: { $eq: [userExpirationSettings.notifyOnceOnly, false] } },
                                // O si el movimiento nunca ha sido notificado (independientemente de la configuración)
                                {
                                    notifications: {
                                        $not: {
                                            $elemMatch: {
                                                type: 'email'
                                            }
                                        }
                                    }
                                }
                            ]
                        },
                        // Y no ha sido notificado hoy (solo aplicable si permite múltiples)
                        {
                            notifications: {
                                $not: {
                                    $elemMatch: {
                                        type: 'email',
                                        date: {
                                            $gte: new Date(todayDateString),
                                            $lt: new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                                        }
                                    }
                                }
                            }
                        }
                    ]
                },

                // Movimientos con configuración explícita para permitir múltiples notificaciones
                {
                    'notificationSettings.notifyOnceOnly': false,
                    notifications: {
                        $not: {
                            $elemMatch: {
                                type: 'email',
                                date: {
                                    $gte: new Date(todayDateString),
                                    $lt: new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                                }
                            }
                        }
                    }
                },

                // Movimientos configurados para notificar una sola vez y que nunca han sido notificados
                {
                    'notificationSettings.notifyOnceOnly': true,
                    notifications: {
                        $not: {
                            $elemMatch: {
                                type: 'email'
                            }
                        }
                    }
                }
            ];
        } else {
            // Si estamos forzando notificaciones diarias, solo nos aseguramos de que
            // no se haya notificado hoy
            query.$or = [
                { notifications: { $exists: false } },
                { notifications: { $size: 0 } },
                {
                    notifications: {
                        $not: {
                            $elemMatch: {
                                type: 'email',
                                date: {
                                    $gte: new Date(todayDateString),
                                    $lt: new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                                }
                            }
                        }
                    }
                }
            ];
        }

        // Búsqueda de movimientos que coincidan con los criterios
        const upcomingMovements = await Movement.find(query).sort({ dateExpiration: 1 });

        if (upcomingMovements.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: 'No hay movimientos próximos a expirar para notificar o ya fueron notificados según su configuración',
                notified: false,
                forceDaily: forceDaily,
                daysInAdvance: daysInAdvance
            };
        }

        // Crear el contenido del correo electrónico
        const subject = `Law||Analytics: Tienes ${upcomingMovements.length} movimiento(s) próximo(s) a expirar`;

        // Construir una tabla HTML con los movimientos
        let htmlContent = `
          <h2>Recordatorio de movimientos próximos a expirar</h2>
          <p>Hola ${user.firstName || 'Usuario'},</p>
          <p>Te recordamos que tienes los siguientes movimientos que expiran en los próximos ${daysInAdvance} días:</p>
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
        textContent += `Te recordamos que tienes los siguientes movimientos que expiran en los próximos ${daysInAdvance} días:\n\n`;

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
            daysInAdvance: daysInAdvance
        };

    } catch (error) {
        return {
            success: false,
            statusCode: 500,
            message: 'Error al enviar notificaciones de movimientos',
            error: error.message
        };
    }
};


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

        // Usar el parámetro days si se proporcionó, o la configuración del usuario
        const daysInAdvance = requestedDaysInAdvance || userCalendarSettings.daysInAdvance || 5;

        if (daysInAdvance < 1) {
            return {
                success: false,
                statusCode: 400,
                message: 'El número de días debe ser un valor positivo'
            };
        }

        // Calcular las fechas límites para el rango (ignorando la hora)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + daysInAdvance);
        futureDate.setHours(23, 59, 59, 999);

        const todayDateString = today.toISOString().split('T')[0];

        // Importamos ObjectId correctamente
        const ObjectId = mongoose.Types.ObjectId;

        // Construimos el filtro para encontrar eventos por fecha
        let aggregationPipeline = [
            // Etapa 1: Match inicial por usuario
            { $match: { userId: new ObjectId(userId) } },

            // Etapa 2: Creamos campos calculados para las fechas sin hora
            {
                $addFields: {
                    // Convertimos la fecha de inicio a una cadena YYYY-MM-DD y luego de vuelta a fecha
                    startDate: {
                        $dateFromString: {
                            dateString: { $dateToString: { format: "%Y-%m-%d", date: "$start" } },
                            format: "%Y-%m-%d"
                        }
                    }
                }
            },

            // Etapa 3: Filtramos por el rango de fechas (sin considerar la hora)
            {
                $match: {
                    startDate: {
                        $gte: today,
                        $lte: futureDate
                    }
                }
            }
        ];

        // Si no estamos forzando notificaciones diarias, añadimos filtros de configuración
        if (!forceDaily) {
            // Consideramos lo siguiente:
            // 1. Eventos sin configuración usan la configuración global del usuario
            // 2. Eventos con configuración usan su configuración propia
            // 3. Eventos sin notificaciones anteriores se notifican siempre
            aggregationPipeline.push(
                {
                    $match: {
                        $or: [
                            // Eventos sin notificaciones (nunca notificados)
                            { notifications: { $exists: false } },
                            { notifications: { $size: 0 } },

                            // Eventos que NO tienen configuración propia (usan la configuración global) 
                            // Y la configuración global permite múltiples notificaciones
                            // Y no han sido notificados hoy
                            {
                                'notificationSettings.notifyOnceOnly': { $exists: false },
                                notifications: {
                                    $not: {
                                        $elemMatch: {
                                            type: 'email',
                                            date: {
                                                $gte: new Date(todayDateString),
                                                $lt: new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                                            }
                                        }
                                    }
                                }
                            },

                            // Eventos con notifyOnceOnly=false (permiten múltiples) y no han sido notificados hoy
                            {
                                'notificationSettings.notifyOnceOnly': false,
                                notifications: {
                                    $not: {
                                        $elemMatch: {
                                            type: 'email',
                                            date: {
                                                $gte: new Date(todayDateString),
                                                $lt: new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                                            }
                                        }
                                    }
                                }
                            },

                            // Eventos con notifyOnceOnly=true que nunca han sido notificados por email
                            {
                                'notificationSettings.notifyOnceOnly': true,
                                notifications: {
                                    $not: {
                                        $elemMatch: {
                                            type: 'email'
                                        }
                                    }
                                }
                            }
                        ]
                    }
                }
            );
        } else {
            // Si forzamos diarias, solo filtramos por notificaciones de hoy
            aggregationPipeline.push(
                {
                    $match: {
                        $or: [
                            // Eventos sin notificaciones
                            { notifications: { $exists: false } },
                            { notifications: { $size: 0 } },

                            // Eventos que no han sido notificados hoy
                            {
                                notifications: {
                                    $not: {
                                        $elemMatch: {
                                            type: 'email',
                                            date: {
                                                $gte: new Date(todayDateString),
                                                $lt: new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                                            }
                                        }
                                    }
                                }
                            }
                        ]
                    }
                }
            );
        }

        // Ordenamos por fecha de inicio
        aggregationPipeline.push({ $sort: { start: 1 } });

        // Ejecutar la agregación
        const upcomingEvents = await Event.aggregate(aggregationPipeline);

        if (upcomingEvents.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: 'No hay eventos próximos para notificar o ya fueron notificados según su configuración',
                notified: false,
                forceDaily: forceDaily,
                daysInAdvance: daysInAdvance
            };
        }

        // Crear el contenido del correo electrónico
        const subject = `Law||Analytics: Tienes ${upcomingEvents.length} evento(s) próximo(s) en tu calendario`;

        // Construir una tabla HTML con los eventos
        let htmlContent = `
          <h2>Recordatorio de eventos próximos</h2>
          <p>Hola ${user.firstName || 'Usuario'},</p>
          <p>Te recordamos que tienes los siguientes eventos programados en los próximos ${daysInAdvance} días:</p>
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
        textContent += `Te recordamos que tienes los siguientes eventos programados en los próximos ${daysInAdvance} días:\n\n`;

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
            daysInAdvance: daysInAdvance
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

        // Usar el parámetro days del request si se proporcionó, o la configuración del usuario
        const daysInAdvance = requestedDaysInAdvance || userExpirationSettings.daysInAdvance || 5;

        if (daysInAdvance < 1) {
            return {
                success: false,
                statusCode: 400,
                message: 'El número de días debe ser un valor positivo'
            };
        }

        // Calcular las fechas límites para el rango (ignorando la hora)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + daysInAdvance);
        futureDate.setHours(23, 59, 59, 999);

        const todayDateString = today.toISOString().split('T')[0];

        // Construir la consulta principal (simplificada)
        let query = {
            // Convertir userId a string para asegurar compatibilidad
            userId: userObjectId,
            // Solo tareas activas
            status: { $nin: ['completada', 'cancelada'] },
            checked: false,
            // Tareas cuya fecha de vencimiento está en el rango especificado
            dueDate: {
                $gte: today,
                $lte: futureDate
            }
        };

        // Si no estamos forzando notificaciones diarias, añadir filtros para notificaciones
        if (!forceDaily) {
            query.$or = [
                // Tareas sin notificaciones (nunca notificadas)
                { notifications: { $exists: false } },
                { notifications: { $size: 0 } },

                // Tareas sin configuración propia (usan la configuración global)
                // Y la configuración global permite múltiples notificaciones
                // Y no han sido notificadas hoy
                {
                    'notificationSettings.notifyOnceOnly': { $exists: false },
                    $and: [
                        {
                            $or: [
                                // Si la configuración global permite múltiples notificaciones
                                { $expr: { $eq: [userExpirationSettings.notifyOnceOnly, false] } },
                                // O si la tarea nunca ha sido notificada (independientemente de la configuración)
                                {
                                    notifications: {
                                        $not: {
                                            $elemMatch: {
                                                type: 'email'
                                            }
                                        }
                                    }
                                }
                            ]
                        },
                        // Y no ha sido notificada hoy (solo aplicable si permite múltiples)
                        {
                            notifications: {
                                $not: {
                                    $elemMatch: {
                                        type: 'email',
                                        date: {
                                            $gte: new Date(todayDateString),
                                            $lt: new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                                        }
                                    }
                                }
                            }
                        }
                    ]
                },

                // Tareas con configuración explícita para permitir múltiples notificaciones
                {
                    'notificationSettings.notifyOnceOnly': false,
                    notifications: {
                        $not: {
                            $elemMatch: {
                                type: 'email',
                                date: {
                                    $gte: new Date(todayDateString),
                                    $lt: new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                                }
                            }
                        }
                    }
                },

                // Tareas configuradas para notificar una sola vez y que nunca han sido notificadas
                {
                    'notificationSettings.notifyOnceOnly': true,
                    notifications: {
                        $not: {
                            $elemMatch: {
                                type: 'email'
                            }
                        }
                    }
                }
            ];
        } else {
            // Si estamos forzando notificaciones diarias, solo nos aseguramos de que
            // no se haya notificado hoy
            query.$or = [
                { notifications: { $exists: false } },
                { notifications: { $size: 0 } },
                {
                    notifications: {
                        $not: {
                            $elemMatch: {
                                type: 'email',
                                date: {
                                    $gte: new Date(todayDateString),
                                    $lt: new Date(new Date(todayDateString).setDate(new Date(todayDateString).getDate() + 1))
                                }
                            }
                        }
                    }
                }
            ];
        }

        // Búsqueda directa en lugar de agregación
        const upcomingTasks = await Task.find(query).sort({ dueDate: 1 });


        if (upcomingTasks.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: 'No hay tareas próximas a vencer para notificar o ya fueron notificadas según su configuración',
                notified: false,
                forceDaily: forceDaily,
                daysInAdvance: daysInAdvance
            };
        }

        // Crear el contenido del correo electrónico
        const subject = `Law||Analytics: Tienes ${upcomingTasks.length} tarea(s) próxima(s) a vencer`;

        // Construir una tabla HTML con las tareas
        let htmlContent = `
          <h2>Recordatorio de tareas próximas a vencer</h2>
          <p>Hola ${user.firstName || 'Usuario'},</p>
          <p>Te recordamos que tienes las siguientes tareas que vencen en los próximos ${daysInAdvance} días:</p>
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
        textContent += `Te recordamos que tienes las siguientes tareas que vencen en los próximos ${daysInAdvance} días:\n\n`;

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
            daysInAdvance: daysInAdvance
        };

    } catch (error) {
        return {
            success: false,
            statusCode: 500,
            message: 'Error al enviar notificaciones de tareas',
            error: error.message
        };
    }
};


module.exports = {
    sendCalendarNotifications,
    sendTaskNotifications,
    sendMovementNotifications
};