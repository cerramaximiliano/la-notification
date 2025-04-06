const mongoose = require('mongoose');
const moment = require('moment');

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
    getAlertData: (item, type, dateField, today, moment) => {
        // Obtener la fecha de expiración del elemento
        const expirationDate = new Date(item[dateField]);

        // Establecer la hora a medianoche UTC
        const utcExpirationDate = moment
            ? moment.utc(expirationDate).startOf('day').toDate()
            : new Date(Date.UTC(
                expirationDate.getFullYear(),
                expirationDate.getMonth(),
                expirationDate.getDate(),
                0, 0, 0, 0
            ));

        // Configuración por tipo de elemento
        const typeConfig = {
            movement: {
                icon: 'TableDocument',
                actionText: 'Ver movimiento'
            },
            event: {
                icon: 'CalendarRemove',
                actionText: 'Ver evento'
            },
            task: {
                icon: 'TaskSquare',
                actionText: 'Ver tarea'
            }
        };

        const config = typeConfig[type];

        // Formatear la fecha para mostrarla en la alerta
        const formattedDate = moment
            ? moment.utc(expirationDate).format('DD/MM/YYYY')
            : `${String(expirationDate.getDate()).padStart(2, '0')}/${String(expirationDate.getMonth() + 1).padStart(2, '0')}/${expirationDate.getFullYear()}`;

        // Crear objeto con los datos de la alerta (sin primaryText)
        return {
            avatarIcon: config.icon,
            avatarType: 'icon',
            avatarSize: 40,
            // Ya no incluimos primaryText ni primaryVariant, el cliente los calculará
            secondaryText: type === 'task'
                ? item.name || item.title
                : `${item.title} - ${formattedDate}`,
            expirationDate: utcExpirationDate, // Fecha de expiración estandarizada en UTC
            actionText: config.actionText
        };
    }
};

/**
 * Función unificada para enviar alertas de navegador
 */
async function sendBrowserAlerts({
    type, // 'movement', 'event', o 'task'
    days: requestedDaysInAdvance = null,
    forceDaily = false,
    userId: requestUserId,
    user: reqUser,
    models,
    utilities: { logger, mongoose, moment }
}) {
    try {
        // Mapeo de tipos a modelos
        const modelMap = {
            movement: models.Movement,
            event: models.Event,
            task: models.Task
        };

        // Mapeo de tipos a campos de fecha
        const dateFieldMap = {
            movement: 'dateExpiration',
            event: 'start',
            task: 'dueDate'
        };

        // Verificar tipo válido
        if (!modelMap[type]) {
            return {
                success: false,
                statusCode: 400,
                message: `Tipo de alerta no válido: ${type}`
            };
        }

        // Modelo correspondiente al tipo
        const ItemModel = modelMap[type];
        const dateField = dateFieldMap[type];

        // Obtener userId
        const userId = requestUserId || (reqUser && reqUser._id);
        if (!userId) {
            return {
                success: false,
                statusCode: 400,
                message: 'Se requiere un ID de usuario. Proporcione userId como parámetro o use una sesión autenticada.'
            };
        }

        const userObjectId = mongoose.Types.ObjectId(userId.toString());

        // Buscar usuario
        const user = await models.User.findById(userObjectId);
        if (!user) {
            return {
                success: false,
                statusCode: 404,
                message: 'Usuario no encontrado'
            };
        }

        // Verificar notificaciones habilitadas
        const notificationsEnabled = helpers.checkUserNotificationsEnabled(user, type);
        if (!notificationsEnabled) {
            return {
                success: true,
                statusCode: 200,
                message: `Las notificaciones de navegador para ${type} no están habilitadas para este usuario`,
                notified: false
            };
        }

        // Obtener configuración de notificaciones
        const userSettings = helpers.getUserNotificationSettings(user, type);
        const globalDaysInAdvance = requestedDaysInAdvance || userSettings.daysInAdvance || 5;

        if (globalDaysInAdvance < 1) {
            return {
                success: false,
                statusCode: 400,
                message: 'El número de días debe ser un valor positivo'
            };
        }

        // Fechas para el rango de búsqueda
        const today = moment ? moment.utc().startOf('day').toDate() : new Date(new Date().setHours(0, 0, 0, 0));
        const maxDaysInAdvance = 30;
        const maxFutureDate = moment
            ? moment.utc().startOf('day').add(maxDaysInAdvance, 'days').endOf('day').toDate()
            : new Date(new Date(today).setDate(today.getDate() + maxDaysInAdvance));

        const todayDateString = moment
            ? moment.utc().format('YYYY-MM-DD')
            : new Date().toISOString().split('T')[0];

        // Consulta base según el tipo
        const baseQuery = {
            userId: userObjectId,
            browserAlertSent: { $ne: true }
        };

        // Añadir condiciones específicas por tipo
        if (type === 'movement' || type === 'event') {
            baseQuery[dateField] = {
                $exists: true,
                $ne: null,
                $gte: today,
                $lte: maxFutureDate
            };
        } else if (type === 'task') {
            baseQuery.status = { $nin: ['completada', 'cancelada'] };
            baseQuery.checked = false;
            baseQuery[dateField] = {
                $gte: today,
                $lte: maxFutureDate
            };
        }

        // Buscar elementos iniciales
        let initialItems = await ItemModel.find(baseQuery).sort({ [dateField]: 1 });

        // Filtrar según configuración específica
        const upcomingItems = initialItems.filter(item => {
            // Verificar si el elemento está en el rango específico
            const itemDate = new Date(item[dateField]);
            const { shouldNotify, itemDaysInAdvance } = helpers.shouldNotifyItem(
                item,
                userSettings,
                forceDaily,
                todayDateString
            );

            // Calcular fecha futura específica para este elemento
            const itemFutureDate = moment
                ? helpers.calculateFutureDate(itemDaysInAdvance, moment)
                : new Date(new Date(today).setDate(today.getDate() + itemDaysInAdvance));

            const isInRange = itemDate <= itemFutureDate;

            return isInRange && shouldNotify;
        });

        if (upcomingItems.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: `No hay ${type}s próximos para notificar o ya fueron notificados según su configuración`,
                notified: false,
                forceDaily: forceDaily,
                daysInAdvance: globalDaysInAdvance
            };
        }

        // Crear detalles de notificación
        const notificationDetails = {
            date: new Date(),
            type: 'browser',
            success: true,
            details: `Alerta creada en el navegador`
        };

        // Inicializar configuración para elementos sin ella
        await ItemModel.updateMany(
            {
                _id: { $in: upcomingItems.map(item => item._id) },
                notificationSettings: { $exists: false }
            },
            {
                $set: {
                    notificationSettings: {
                        notifyOnceOnly: userSettings.notifyOnceOnly,
                        daysInAdvance: userSettings.daysInAdvance
                    }
                }
            }
        );

        // Inicializar array de notificaciones
        await ItemModel.updateMany(
            {
                _id: { $in: upcomingItems.map(item => item._id) },
                notifications: { $exists: false }
            },
            { $set: { notifications: [] } }
        );

        // Crear alertas para cada elemento
        const alertPromises = upcomingItems.map(async (item) => {
            // Obtener datos de la alerta con expirationDate estandarizada
            const alertData = helpers.getAlertData(
                item,
                type,
                dateField,
                today,
                moment
            );

            // Crear alerta
            const newAlert = await models.Alert.create({
                userId: userId,
                folderId: item.folderId || new mongoose.Types.ObjectId(),
                ...alertData
            });

            // Intentar enviar por WebSocket
            try {
                const websocketService = require('./websocket');

                if (websocketService.isUserConnected(userId)) {
                    await websocketService.sendPushAlert(userId, newAlert);
                    logger.info(`Alerta push enviada al usuario ${userId} para ${type} ${item._id}`);
                } else {
                    logger.info(`Usuario ${userId} no conectado, la alerta quedará pendiente`);
                }
            } catch (wsError) {
                logger.error(`Error al enviar alerta push para ${type}: ${wsError.message}`);
            }

            // Actualizar el elemento
            await ItemModel.updateOne(
                { _id: item._id },
                {
                    $push: { notifications: notificationDetails },
                    $set: { browserAlertSent: true }
                }
            );

            return item._id;
        });

        // Esperar a que se creen todas las alertas
        const itemIds = await Promise.all(alertPromises);

        logger.info(`Alertas de navegador creadas para el usuario ${user.email} para ${upcomingItems.length} ${type}s`);

        return {
            success: true,
            statusCode: 200,
            message: `Se han creado alertas en el navegador para ${upcomingItems.length} ${type}(s) próximos`,
            count: upcomingItems.length,
            notified: true,
            userId: userId,
            [`${type}Ids`]: itemIds,
            forceDaily: forceDaily,
            daysInAdvance: globalDaysInAdvance
        };

    } catch (error) {
        logger.error(`Error al crear alertas de navegador para ${type}s: ${error.message}`);
        return {
            success: false,
            statusCode: 500,
            message: `Error al crear alertas de navegador para ${type}s`,
            error: error.message
        };
    }
}

// Funciones específicas que mantienen la interfaz original
async function sendMovementBrowserAlerts(params) {
    return sendBrowserAlerts({ ...params, type: 'movement' });
}

async function sendCalendarBrowserAlerts(params) {
    return sendBrowserAlerts({ ...params, type: 'event' });
}

async function sendTaskBrowserAlerts(params) {
    return sendBrowserAlerts({ ...params, type: 'task' });
}


module.exports = {
    sendTaskBrowserAlerts,
    sendMovementBrowserAlerts,
    sendCalendarBrowserAlerts,
}