const mongoose = require('mongoose');
const moment = require('moment');
const momentTz = require('moment-timezone');
const pushChannel = require('./channels/push');
const { buildTaskRecipientFilter } = require('./teamRecipients');
const eventRecipientsSvc = require('./eventRecipients');
const taskRecipientMarks = require('./taskRecipientMarks');

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
                userNotificationsEnabled = notifications.user && notifications.user.expiration !== false;
                break;
            case 'task':
                // Para tareas, se notifica cuando taskExpiration no sea explícitamente false
                userNotificationsEnabled = notifications.user && notifications.user.taskExpiration !== false;
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
                return notifications.expirationSettings || { notifyOnceOnly: true, daysInAdvance: 5 };
            case 'task':
                // Para tareas, usa taskExpirationSettings
                return notifications.taskExpirationSettings || { notifyOnceOnly: true, daysInAdvance: 5 };
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
     * Variante por destinatario para tareas: la marca «ya avisada» y la
     * configuración (notifyOnceOnly / daysInAdvance) son del usuario que se está
     * procesando, no de la tarea (services/taskRecipientMarks.js).
     */
    shouldNotifyEventRecipient: (event, userId, globalSettings, forceDaily, todayDateString) => {
        const settings = eventRecipientsSvc.recipientSettings(event, userId, globalSettings);
        const shouldNotify = taskRecipientMarks.shouldNotifyRecipient({
            task: event,
            userId,
            channel: 'browser',
            notifyOnceOnly: settings.notifyOnceOnly,
            forceDaily,
            todayDateString
        });
        return { shouldNotify, itemDaysInAdvance: settings.daysInAdvance };
    },

    shouldNotifyTaskRecipient: (task, userId, globalSettings, forceDaily, todayDateString) => {
        const settings = taskRecipientMarks.effectiveRecipientSettings(task, globalSettings);
        const shouldNotify = taskRecipientMarks.shouldNotifyRecipient({
            task,
            userId,
            channel: 'browser',
            notifyOnceOnly: settings.notifyOnceOnly,
            forceDaily,
            todayDateString
        });
        return { shouldNotify, itemDaysInAdvance: settings.daysInAdvance };
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

        const userObjectId = new mongoose.Types.ObjectId(userId.toString());

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

        // Eventos (Equipos, 30/10/2026): candidatos del destinatario y del owner de su
        // equipo; la marca «ya avisado» es por destinatario (se decide abajo).
        let eventScope = null;
        if (type === 'event') {
            eventScope = await eventRecipientsSvc.scopeEventsForRecipient(userId);
            // Fuera de un equipo, la consulta de siempre (sin cambios de comportamiento).
            if (eventScope.ctx) {
                delete baseQuery.userId;
                delete baseQuery.browserAlertSent;
                Object.assign(baseQuery, eventScope.userFilter);
            }
        }
        const teamEvents = type === 'event' && !!(eventScope && eventScope.ctx);

        // Añadir condiciones específicas por tipo
        if (type === 'movement' || type === 'event') {
            baseQuery[dateField] = {
                $exists: true,
                $ne: null,
                $gte: today,
                $lte: maxFutureDate
            };
        } else if (type === 'task') {
            // Tareas: se le recuerdan a sus asignados o, sin asignados, a su dueño.
            // La marca «ya avisada» es por destinatario (notificationRecipients), así
            // que browserAlertSent no filtra acá: se decide abajo por destinatario.
            delete baseQuery.userId;
            delete baseQuery.browserAlertSent;
            Object.assign(baseQuery, buildTaskRecipientFilter(userObjectId));
            baseQuery.status = { $nin: ['completada', 'cancelada'] };
            baseQuery.checked = false;
            baseQuery[dateField] = {
                $gte: today,
                $lte: maxFutureDate
            };
        }

        // Buscar elementos iniciales
        let initialItems = await ItemModel.find(baseQuery).sort({ [dateField]: 1 });
        if (teamEvents) {
            initialItems = await eventRecipientsSvc.keepEventsForRecipient(initialItems, userId, eventScope && eventScope.ctx);
        }

        // Filtrar según configuración específica
        const upcomingItems = initialItems.filter(item => {
            // Verificar si el elemento está en el rango específico
            const itemDate = new Date(item[dateField]);
            const { shouldNotify, itemDaysInAdvance } = type === 'task'
                ? helpers.shouldNotifyTaskRecipient(item, userId, userSettings, forceDaily, todayDateString)
                : teamEvents
                    ? helpers.shouldNotifyEventRecipient(item, userId, userSettings, forceDaily, todayDateString)
                    : helpers.shouldNotifyItem(item, userSettings, forceDaily, todayDateString);

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
            details: type === 'task'
                ? `Alerta creada en el navegador para ${userId}`
                : `Alerta creada en el navegador`
        };

        // Tareas con responsables: la configuración es de cada destinatario, no se
        // espeja en la tarea (si no, el primero procesado se la impone al resto).
        const teamItems = type === 'task'
            ? upcomingItems.filter(item => taskRecipientMarks.hasAssignees(item))
            : teamEvents
                ? upcomingItems.filter(item => String(item.userId) !== String(userId))
                : [];
        const individualItems = upcomingItems.filter(item => !teamItems.includes(item));

        // Inicializar configuración para elementos sin ella
        await ItemModel.updateMany(
            {
                _id: { $in: individualItems.map(item => item._id) },
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

        // Importar helper para operaciones atómicas
        const { addNotificationsSequential } = require('./notificationHelper');
        
        // Procesar alertas secuencialmente para evitar condiciones de carrera
        const processedItems = [];
        const websocketService = require('./websocket');
        
        for (const item of upcomingItems) {
            try {
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
                    folderId: item.folderId, // Ahora es opcional
                    sourceType: type, // 'event', 'task', o 'movement'
                    sourceId: item._id, // ID del item original
                    ...alertData
                });

                // Intentar enviar por WebSocket
                try {
                    if (websocketService.isUserConnected(userId)) {
                        await websocketService.sendPushAlert(userId, newAlert);
                        logger.info(`Alerta push enviada al usuario ${userId} para ${type} ${item._id}`);
                    } else {
                        logger.info(`Usuario ${userId} no conectado, la alerta quedará pendiente`);
                    }
                } catch (wsError) {
                    logger.error(`Error al enviar alerta push para ${type}: ${wsError.message}`);
                }

                // Push a la app mobile (FCM). Best-effort y en paralelo al socket: llega
                // aunque el usuario no tenga la web abierta. No-op sin Firebase configurado.
                pushChannel.pushAlert(userId, newAlert);

                processedItems.push(item);

                // Tareas y eventos: marca por destinatario (la que decide la próxima vez).
                if (type === 'task' || teamEvents) {
                    await taskRecipientMarks.markTaskRecipientNotified(ItemModel, item, userId, 'browser', {
                        now: notificationDetails.date
                    });
                }

            } catch (error) {
                logger.error(`Error procesando alerta para ${type} ${item._id}:`, error);
            }
        }

        // Usar operación atómica para agregar notificaciones sin duplicados.
        // Las marcas por tarea (notifications/browserAlertSent) se siguen escribiendo
        // por compatibilidad; en tareas con responsables no se espeja la configuración.
        const notificationResult = { total: 0, successful: 0, skipped: 0, failed: 0 };
        const batches = [
            [processedItems.filter(item => !teamItems.includes(item)), { windowSeconds: 5, userSettings: userSettings }],
            [processedItems.filter(item => teamItems.includes(item)), { windowSeconds: 5 }]
        ];
        for (const [batch, options] of batches) {
            if (batch.length === 0) continue;
            const r = await addNotificationsSequential(ItemModel, batch, notificationDetails, options);
            notificationResult.total += r.total;
            notificationResult.successful += r.successful;
            notificationResult.skipped += r.skipped;
            notificationResult.failed += r.failed;
        }

        logger.info(`Notificaciones de browser agregadas: ${notificationResult.successful}/${notificationResult.total}, omitidas: ${notificationResult.skipped}, errores: ${notificationResult.failed}`);

        logger.info(`Alertas de navegador creadas para el usuario ${user.email} para ${upcomingItems.length} ${type}s`);

        return {
            success: true,
            statusCode: 200,
            message: `Se han creado alertas en el navegador para ${upcomingItems.length} ${type}(s) próximos`,
            count: upcomingItems.length,
            notified: true,
            userId: userId,
            [`${type}Ids`]: processedItems.map(item => item._id),
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


/**
 * Función para enviar alertas de navegador para movimientos judiciales
 */
async function sendJudicialMovementBrowserAlerts({
    days: requestedDaysInAdvance = null,
    forceDaily = false,
    userId: requestUserId,
    user: reqUser,
    // IDs ya notificados por email en esta corrida: el caller los marca 'sent'
    // ANTES de llamar acá, así que la consulta por status 'pending' no los ve.
    movementIds = null,
    // Zona horaria del "día" para el tope de una alerta por causa y por día
    // (la de notificationSchedule, la misma que usa el filtro del email).
    timezone = 'America/Argentina/Buenos_Aires',
    models,
    utilities: { logger, mongoose, moment }
}) {
    try {
        // Obtener userId
        const userId = requestUserId || (reqUser && reqUser._id);
        if (!userId) {
            return {
                success: false,
                statusCode: 400,
                message: 'Se requiere un ID de usuario.'
            };
        }

        const userObjectId = new mongoose.Types.ObjectId(userId.toString());

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
        const notificationsEnabled = helpers.checkUserNotificationsEnabled(user, 'movement');
        if (!notificationsEnabled) {
            return {
                success: true,
                statusCode: 200,
                message: 'Las notificaciones de navegador para movimientos judiciales no están habilitadas',
                notified: false
            };
        }

        // Obtener configuración de notificaciones
        const userSettings = helpers.getUserNotificationSettings(user, 'movement');
        const globalDaysInAdvance = requestedDaysInAdvance || userSettings.daysInAdvance || 5;

        // Buscar movimientos judiciales pendientes de notificar
        // Los movimientos judiciales se notifican cuando ya ocurrieron (fecha pasada o actual)
        const baseQuery = Array.isArray(movementIds) && movementIds.length > 0
            ? { userId: userObjectId, _id: { $in: movementIds } }
            : { userId: userObjectId, notificationStatus: 'pending' };

        // Buscar movimientos pendientes
        // Si no tienen channels definido o incluyen 'browser'
        const judicialMovements = await models.JudicialMovement.find({
            ...baseQuery,
            $or: [
                { 'notificationSettings.channels': 'browser' },
                { 'notificationSettings.channels': { $exists: false } },
                { 'notificationSettings.channels': [] }
            ]
        }).sort({ 'movimiento.fecha': 1 });

        logger.info(`Movimientos judiciales encontrados: ${judicialMovements.length} para usuario ${userId}`);

        // Una alerta por causa y por día, aunque los movimientos lleguen en tandas
        // distintas (el cron entrega cada 30 min). Si la causa ya tuvo aviso de
        // navegador hoy, el de la mañana ya lleva a la carpeta con todos sus
        // movimientos: los de la tarde no generan otro.
        //
        // Se corta por día calendario de Argentina, no de UTC: la tanda de las
        // 21:00 ART ya es el día siguiente en UTC y con UTC se colaba un segundo
        // aviso de la misma causa.
        const inicioDelDia = momentTz.tz(timezone).startOf('day').toDate();
        const avisadoHoy = (m) => Array.isArray(m.notifications) && m.notifications.some(
            n => n.type === 'browser' && n.date && new Date(n.date) >= inicioDelDia
        );

        const causaIds = [...new Set(judicialMovements.map(m => m.expediente && m.expediente.id).filter(Boolean))];
        let causasAvisadasHoy = new Set();
        if (causaIds.length > 0) {
            try {
                causasAvisadasHoy = new Set(
                    await models.JudicialMovement.distinct('expediente.id', {
                        userId: userObjectId,
                        'expediente.id': { $in: causaIds },
                        notifications: { $elemMatch: { type: 'browser', date: { $gte: inicioDelDia } } }
                    })
                );
            } catch (e) {
                // Sin el chequeo se arriesga un aviso repetido; sin aviso se pierde
                // uno. Preferimos lo primero.
                logger.warn(`No se pudo verificar causas ya avisadas hoy: ${e.message}`);
            }
        }

        const upcomingMovements = judicialMovements.filter(movement => {
            if (avisadoHoy(movement)) return false;
            const causaId = movement.expediente && movement.expediente.id;
            return !(causaId && causasAvisadasHoy.has(causaId));
        });

        if (upcomingMovements.length < judicialMovements.length) {
            logger.info(
                `Una alerta por causa y día: ${judicialMovements.length - upcomingMovements.length} movimiento(s) ` +
                `sin aviso nuevo (${causasAvisadasHoy.size} causa(s) ya avisadas hoy)`
            );
        }

        logger.info(`Movimientos después de filtrar notificaciones de hoy: ${upcomingMovements.length}`);

        if (upcomingMovements.length === 0) {
            return {
                success: true,
                statusCode: 200,
                message: 'No hay movimientos judiciales próximos para notificar',
                notified: false,
                daysInAdvance: globalDaysInAdvance
            };
        }

        // Procesar alertas
        const processedMovements = [];
        const websocketService = require('./websocket');
        // Carpeta del usuario para la causa (el click de la alerta navega a
        // /apps/folders/details/:folderId). Una consulta por expediente.
        const folderByCausa = new Map();
        const resolveFolderId = async (causaId) => {
            if (!models.Folder || !causaId) return null;
            if (folderByCausa.has(causaId)) return folderByCausa.get(causaId);
            let folderId = null;
            try {
                const folders = await models.Folder.find({ userId: userObjectId, causaId }, { _id: 1, archived: 1 }).lean();
                const preferred = folders.find(f => f.archived !== true) || folders[0];
                folderId = preferred ? preferred._id : null;
            } catch (e) {
                logger.warn(`No se pudo resolver la carpeta de la causa ${causaId}: ${e.message}`);
            }
            folderByCausa.set(causaId, folderId);
            return folderId;
        };

        // Una alerta por causa, no por movimiento. El click lleva a la carpeta
        // con todos sus movimientos, así que N avisos de la misma carátula solo
        // llenaban la bandeja (y, con FCM, el teléfono). Sin expediente.id el
        // movimiento va solo: no hay con qué agruparlo.
        const groups = new Map();
        for (const movement of upcomingMovements) {
            const key = (movement.expediente && movement.expediente.id) || `mov:${movement._id}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(movement);
        }

        let alertsCreated = 0;
        for (const group of groups.values()) {
            // upcomingMovements viene ordenado por fecha ascendente: el último es
            // el más reciente y es el que representa al grupo.
            const latest = group[group.length - 1];
            try {
                const formattedDate = moment.utc(latest.movimiento.fecha).format('DD/MM/YYYY');
                const folderId = await resolveFolderId(latest.expediente && latest.expediente.id);
                const isSingle = group.length === 1;

                // sourceType 'movement' + avatarIcon 'TableDocument': únicos valores del
                // enum de Alert (la-notification / hub / la-subscriptions) que el front
                // renderiza como movimiento y navega a la carpeta (Notification.tsx).
                // primaryText explícito: si falta, el front lo deriva de expirationDate
                // como vencimiento ("Movimiento vencido hace N días").
                const alertData = {
                    avatarIcon: 'TableDocument',
                    avatarType: 'icon',
                    avatarSize: 40,
                    // Sin el tipo de movimiento: denominaciones como "DESPACHO" no
                    // dicen nada y el detalle está en la carpeta.
                    primaryText: isSingle ? 'Nuevo movimiento' : 'Nuevos movimientos',
                    secondaryText: `${latest.expediente.caratula} · ${formattedDate}`,
                    expirationDate: latest.movimiento.fecha,
                    actionText: 'Ver movimientos'
                };

                const newAlert = await models.Alert.create({
                    userId: userId,
                    folderId: folderId || undefined,
                    sourceType: 'movement',
                    sourceId: latest._id,
                    ...alertData
                });

                // Intentar enviar por WebSocket
                try {
                    if (websocketService.isUserConnected(userId)) {
                        await websocketService.sendPushAlert(userId, newAlert);
                        logger.info(`Alerta push enviada al usuario ${userId} para ${group.length} movimiento(s) de la causa ${latest.expediente && latest.expediente.id}`);
                    } else {
                        logger.info(`Usuario ${userId} no conectado, la alerta de movimiento judicial quedará pendiente`);
                    }
                } catch (wsError) {
                    logger.error(`Error al enviar alerta push para movimiento judicial: ${wsError.message}`);
                }

                // Push a la app mobile (FCM), best-effort.
                pushChannel.pushAlert(userId, newAlert);

                alertsCreated++;
                processedMovements.push(...group);

            } catch (error) {
                logger.error(`Error procesando alerta para la causa del movimiento judicial ${latest._id}:`, error);
            }
        }

        logger.info(`Alertas de navegador creadas: ${alertsCreated} para ${processedMovements.length} movimientos judiciales`);

        return {
            success: true,
            statusCode: 200,
            message: `Se han creado alertas en el navegador para ${processedMovements.length} movimiento(s) judicial(es)`,
            count: processedMovements.length,
            alertsCount: alertsCreated,
            notified: true,
            userId: userId,
            movementIds: processedMovements.map(m => m._id),
            daysInAdvance: globalDaysInAdvance
        };

    } catch (error) {
        logger.error(`Error al crear alertas de navegador para movimientos judiciales: ${error.message}`);
        return {
            success: false,
            statusCode: 500,
            message: 'Error al crear alertas de navegador para movimientos judiciales',
            error: error.message
        };
    }
}

module.exports = {
    sendTaskBrowserAlerts,
    sendMovementBrowserAlerts,
    sendCalendarBrowserAlerts,
    sendJudicialMovementBrowserAlerts
}