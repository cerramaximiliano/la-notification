const { Event, Task, Movement, Alert, User, NotificationLog } = require('../models');
const logger = require('../config/logger');
const moment = require('moment-timezone');
const { enrichWithUserInfo } = require('../utils/userHelper');

// Configurar zona horaria
const timezone = 'America/Argentina/Buenos_Aires';

// Helper para obtener información de usuario para notificación
const getUserNotificationInfo = async (userId) => {
  const user = await User.findById(userId).select('name email notificationPreferences');
  if (!user) return null;
  
  return {
    userId: user._id,
    name: user.name,
    email: user.email,
    preferences: user.notificationPreferences
  };
};

// Obtener eventos próximos a notificar
const getUpcomingEvents = async (req, res) => {
  try {
    const { days = 7, limit = 100, page = 1 } = req.query;
    const skip = (page - 1) * limit;
    
    const today = moment().tz(timezone).startOf('day').toDate();
    const endDate = moment().tz(timezone).add(days, 'days').endOf('day').toDate();

    // Primero, veamos cuántos usuarios hay en total
    const totalUsers = await User.countDocuments();
    logger.info(`Total de usuarios en la base de datos: ${totalUsers}`);
    
    // Buscar usuarios con notificaciones de calendario habilitadas
    const usersWithNotifications = await User.find({
      'preferences.notifications.channels.email': true,
      'preferences.notifications.user.calendar': true
    }).select('_id');
    
    logger.info(`Usuarios con notificaciones habilitadas: ${usersWithNotifications.length}`);
    
    // Si no hay usuarios con notificaciones, busquemos sin filtros para debug
    if (usersWithNotifications.length === 0) {
      const allUsers = await User.find({}).select('_id email preferences').limit(5);
      logger.info(`Primeros usuarios en DB: ${JSON.stringify(allUsers)}`);
    }

    const userIds = usersWithNotifications.map(u => u._id);
    
    logger.info(`IDs de usuarios: ${userIds.map(id => id.toString()).join(', ')}`);
    logger.info(`Buscando eventos desde ${today.toISOString()} hasta ${endDate.toISOString()}`);

    // Buscar eventos próximos
    const events = await Event.find({
      userId: { $in: userIds },
      start: { $gte: today, $lte: endDate }
    })
    .populate('userId', 'name email preferences')
    .sort({ start: 1 })
    .skip(skip)
    .limit(parseInt(limit));
    
    logger.info(`Eventos encontrados: ${events.length}`);
    if (events.length > 0) {
      logger.info(`Primer evento: ${JSON.stringify(events[0])}`);
    }

    // Procesar eventos para incluir información de notificación
    const eventsWithNotificationInfo = await Promise.all(events.map(async (event) => {
      const user = event.userId;
      const userPrefs = user.preferences?.notifications?.user?.calendarSettings || { daysInAdvance: 5, notifyOnceOnly: true };
      const eventNotifyConfig = event.notificationSettings || {};
      
      // Determinar configuración final
      const daysInAdvance = eventNotifyConfig.daysInAdvance !== undefined 
        ? eventNotifyConfig.daysInAdvance 
        : userPrefs.daysInAdvance;
      
      const notifyOnceOnly = eventNotifyConfig.notifyOnceOnly !== undefined
        ? eventNotifyConfig.notifyOnceOnly
        : userPrefs.notifyOnceOnly;

      // Calcular cuándo se notificará
      const notificationDate = moment(event.start).subtract(daysInAdvance, 'days').startOf('day');
      const daysUntilEvent = moment(event.start).diff(moment(), 'days');
      const shouldNotifyToday = daysUntilEvent <= daysInAdvance;
      
      // Verificar si ya fue notificado hoy
      const wasNotifiedToday = event.notifications?.some(notification => 
        moment(notification.date).isSame(moment(), 'day')
      );

      return {
        _id: event._id,
        title: event.title,
        description: event.description,
        start: event.start,
        end: event.end,
        type: event.type,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email
        },
        notificationConfig: {
          daysInAdvance,
          notifyOnceOnly,
          notificationDate: notificationDate.toDate(),
          shouldNotifyToday,
          wasNotifiedToday,
          willBeNotified: shouldNotifyToday && (!wasNotifiedToday || !notifyOnceOnly)
        },
        daysUntilEvent
      };
    }));

    // Contar total
    const total = await Event.countDocuments({
      userId: { $in: userIds },
      start: { $gte: today, $lte: endDate }
    });

    res.json({
      success: true,
      data: eventsWithNotificationInfo,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error al obtener eventos próximos:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener eventos próximos'
    });
  }
};

// Obtener tareas próximas a notificar
const getUpcomingTasks = async (req, res) => {
  try {
    const { days = 7, limit = 100, page = 1 } = req.query;
    const skip = (page - 1) * limit;
    
    const today = moment().tz(timezone).startOf('day').toDate();
    const endDate = moment().tz(timezone).add(days, 'days').endOf('day').toDate();

    // Buscar usuarios con notificaciones de expiración habilitadas
    const usersWithNotifications = await User.find({
      'preferences.notifications.channels.email': true,
      'preferences.notifications.user.expiration': true
    }).select('_id');
    
    logger.debug(`Usuarios con notificaciones de tareas habilitadas: ${usersWithNotifications.length}`);

    const userIds = usersWithNotifications.map(u => u._id);

    // Buscar tareas próximas a vencer
    const tasks = await Task.find({
      userId: { $in: userIds },
      dueDate: { $gte: today, $lte: endDate },
      status: { $nin: ['completada', 'cancelada'] }
    })
    .populate('userId', 'name email preferences')
    .sort({ dueDate: 1 })
    .skip(skip)
    .limit(parseInt(limit));

    // Procesar tareas para incluir información de notificación
    const tasksWithNotificationInfo = await Promise.all(tasks.map(async (task) => {
      const user = task.userId;
      const userPrefs = user.preferences?.notifications?.user?.expirationSettings || { daysInAdvance: 5, notifyOnceOnly: true };
      const taskNotifyConfig = task.notificationSettings || {};
      
      // Determinar configuración final
      const daysInAdvance = taskNotifyConfig.daysInAdvance !== undefined 
        ? taskNotifyConfig.daysInAdvance 
        : userPrefs.daysInAdvance;
      
      const notifyOnceOnly = taskNotifyConfig.notifyOnceOnly !== undefined
        ? taskNotifyConfig.notifyOnceOnly
        : userPrefs.notifyOnceOnly;

      // Calcular cuándo se notificará
      const notificationDate = moment(task.dueDate).subtract(daysInAdvance, 'days').startOf('day');
      const daysUntilDue = moment(task.dueDate).diff(moment(), 'days');
      const shouldNotifyToday = daysUntilDue <= daysInAdvance;
      
      // Verificar si ya fue notificado hoy
      const wasNotifiedToday = task.notifications?.some(notification => 
        moment(notification.date).isSame(moment(), 'day')
      );

      return {
        _id: task._id,
        title: task.name,
        description: task.description,
        dueDate: task.dueDate,
        status: task.status,
        priority: task.priority,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email
        },
        notificationConfig: {
          daysInAdvance,
          notifyOnceOnly,
          notificationDate: notificationDate.toDate(),
          shouldNotifyToday,
          wasNotifiedToday,
          willBeNotified: shouldNotifyToday && (!wasNotifiedToday || !notifyOnceOnly)
        },
        daysUntilDue
      };
    }));

    // Contar total
    const total = await Task.countDocuments({
      userId: { $in: userIds },
      dueDate: { $gte: today, $lte: endDate },
      status: { $nin: ['completada', 'cancelada'] }
    });

    res.json({
      success: true,
      data: tasksWithNotificationInfo,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error al obtener tareas próximas:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener tareas próximas'
    });
  }
};

// Obtener movimientos próximos a notificar
const getUpcomingMovements = async (req, res) => {
  try {
    const { days = 7, limit = 100, page = 1 } = req.query;
    const skip = (page - 1) * limit;
    
    const today = moment().tz(timezone).startOf('day').toDate();
    const endDate = moment().tz(timezone).add(days, 'days').endOf('day').toDate();

    // Buscar usuarios con notificaciones de expiración habilitadas
    const usersWithNotifications = await User.find({
      'preferences.notifications.channels.email': true,
      'preferences.notifications.user.expiration': true
    }).select('_id');
    
    logger.debug(`Usuarios con notificaciones de tareas habilitadas: ${usersWithNotifications.length}`);

    const userIds = usersWithNotifications.map(u => u._id);

    // Buscar movimientos próximos a vencer
    const movements = await Movement.find({
      userId: { $in: userIds },
      dateExpiration: { $gte: today, $lte: endDate }
    })
    .populate('userId', 'name email preferences')
    .sort({ dateExpiration: 1 })
    .skip(skip)
    .limit(parseInt(limit));

    // Procesar movimientos para incluir información de notificación
    const movementsWithNotificationInfo = await Promise.all(movements.map(async (movement) => {
      const user = movement.userId;
      const userPrefs = user.preferences?.notifications?.user?.expirationSettings || { daysInAdvance: 5, notifyOnceOnly: true };
      const movementNotifyConfig = movement.notificationSettings || {};
      
      // Determinar configuración final
      const daysInAdvance = movementNotifyConfig.daysInAdvance !== undefined 
        ? movementNotifyConfig.daysInAdvance 
        : userPrefs.daysInAdvance;
      
      const notifyOnceOnly = movementNotifyConfig.notifyOnceOnly !== undefined
        ? movementNotifyConfig.notifyOnceOnly
        : userPrefs.notifyOnceOnly;

      // Calcular cuándo se notificará
      const notificationDate = moment(movement.dateExpiration).subtract(daysInAdvance, 'days').startOf('day');
      const daysUntilExpiration = moment(movement.dateExpiration).diff(moment(), 'days');
      const shouldNotifyToday = daysUntilExpiration <= daysInAdvance;
      
      // Verificar si ya fue notificado hoy
      const wasNotifiedToday = movement.notifications?.some(notification => 
        moment(notification.date).isSame(moment(), 'day')
      );

      return {
        _id: movement._id,
        title: movement.title,
        description: movement.description,
        movement: movement.movement,
        dateExpiration: movement.dateExpiration,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email
        },
        notificationConfig: {
          daysInAdvance,
          notifyOnceOnly,
          notificationDate: notificationDate.toDate(),
          shouldNotifyToday,
          wasNotifiedToday,
          willBeNotified: shouldNotifyToday && (!wasNotifiedToday || !notifyOnceOnly)
        },
        daysUntilExpiration
      };
    }));

    // Contar total
    const total = await Movement.countDocuments({
      userId: { $in: userIds },
      dateExpiration: { $gte: today, $lte: endDate }
    });

    res.json({
      success: true,
      data: movementsWithNotificationInfo,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error al obtener movimientos próximos:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener movimientos próximos'
    });
  }
};

// Obtener alertas pendientes
const getPendingAlerts = async (req, res) => {
  try {
    const { limit = 100, page = 1, userId } = req.query;
    const skip = (page - 1) * limit;
    
    const query = {
      delivered: false
    };
    
    // Solo filtrar por expiración si el campo existe
    if (req.query.includeExpired !== 'true') {
      query.$or = [
        { expirationDate: { $exists: false } },
        { expirationDate: null },
        { expirationDate: { $gt: new Date() } }
      ];
    }

    if (userId) {
      query.userId = userId;
    }

    const alerts = await Alert.find(query)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Alert.countDocuments(query);

    res.json({
      success: true,
      data: alerts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error al obtener alertas pendientes:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener alertas pendientes'
    });
  }
};

// Obtener historial de notificaciones (usando NotificationLog centralizado)
const getNotificationHistory = async (req, res) => {
  try {
    const { 
      type, // 'event', 'task', 'movement', 'alert', 'custom'
      userId,
      startDate,
      endDate,
      limit = 100,
      page = 1,
      status, // 'sent', 'delivered', 'failed', 'pending', 'retry'
      method, // 'email', 'browser', 'webhook', 'sms'
      entityId, // Filtrar por entidad específica
      includeStats = false, // Incluir estadísticas
      sortBy = 'sentAt', // Campo para ordenar
      sortOrder = 'desc' // Orden: asc o desc
    } = req.query;
    
    const skip = (page - 1) * limit;

    // Construir query
    const query = {};
    
    if (userId) query.userId = userId;
    if (type) query.entityType = type;
    if (entityId) query.entityId = entityId;
    if (status) query['notification.status'] = status;
    if (method) query['notification.method'] = method;
    
    // Filtrar por fechas
    if (startDate || endDate) {
      query.sentAt = {};
      if (startDate) query.sentAt.$gte = new Date(startDate);
      if (endDate) query.sentAt.$lte = new Date(endDate);
    }

    // Configurar ordenamiento
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Consultar NotificationLog sin populate para evitar errores
    const [results, total, stats] = await Promise.all([
      NotificationLog.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      NotificationLog.countDocuments(query),
      // Estadísticas opcionales
      includeStats === 'true' ? NotificationLog.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              status: '$notification.status',
              method: '$notification.method'
            },
            count: { $sum: 1 }
          }
        }
      ]) : null
    ]);
    
    // Enriquecer con información de usuario si es posible
    const enrichedResults = await enrichWithUserInfo(results, 'userId');

    // Formatear resultados con toda la información disponible
    const formattedResults = enrichedResults.map(log => ({
      _id: log._id,
      // Información de la entidad
      entity: {
        type: log.entityType,
        id: log.entityId,
        title: log.entitySnapshot?.title,
        description: log.entitySnapshot?.description,
        date: log.entitySnapshot?.date,
        priority: log.entitySnapshot?.priority,
        amount: log.entitySnapshot?.amount
      },
      // Información del usuario
      user: log.userId,
      // Detalles de la notificación
      notification: {
        sentAt: log.sentAt,
        scheduledFor: log.scheduledFor,
        method: log.notification.method,
        status: log.notification.status,
        content: {
          subject: log.notification.content?.subject,
          message: log.notification.content?.message,
          template: log.notification.content?.template,
          data: log.notification.content?.data
        },
        delivery: {
          attempts: log.notification.delivery?.attempts || 1,
          lastAttemptAt: log.notification.delivery?.lastAttemptAt,
          deliveredAt: log.notification.delivery?.deliveredAt,
          failureReason: log.notification.delivery?.failureReason,
          recipientEmail: log.notification.delivery?.recipientEmail,
          recipientPhone: log.notification.delivery?.recipientPhone
        }
      },
      // Configuración utilizada
      config: log.config,
      // Metadatos
      metadata: {
        ...log.metadata,
        createdAt: log.createdAt,
        updatedAt: log.updatedAt
      }
    }));

    // Formatear estadísticas si se solicitaron
    const formattedStats = stats ? stats.reduce((acc, stat) => {
      const key = `${stat._id.method}_${stat._id.status}`;
      acc[key] = stat.count;
      return acc;
    }, {}) : null;

    res.json({
      success: true,
      data: formattedResults,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
        hasMore: (page * limit) < total
      },
      ...(formattedStats && { statistics: formattedStats }),
      filters: {
        applied: {
          ...(userId && { userId }),
          ...(type && { type }),
          ...(entityId && { entityId }),
          ...(status && { status }),
          ...(method && { method }),
          ...(startDate && { startDate }),
          ...(endDate && { endDate })
        },
        available: {
          types: ['event', 'task', 'movement', 'alert', 'custom'],
          statuses: ['sent', 'delivered', 'failed', 'pending', 'retry'],
          methods: ['email', 'browser', 'webhook', 'sms']
        }
      }
    });

  } catch (error) {
    logger.error('Error al obtener historial de notificaciones:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener historial de notificaciones',
      message: error.message
    });
  }
};

// Obtener resumen de notificaciones (usando NotificationLog)
const getNotificationSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query = {};
    if (startDate || endDate) {
      query.sentAt = {};
      if (startDate) query.sentAt.$gte = new Date(startDate);
      if (endDate) query.sentAt.$lte = new Date(endDate);
    } else {
      // Por defecto, últimos 30 días
      query.sentAt = {
        $gte: moment().subtract(30, 'days').toDate(),
        $lte: new Date()
      };
    }

    // Usar agregación para obtener resumen eficiente
    const aggregation = await NotificationLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            entityType: '$entityType',
            method: '$notification.method',
            status: '$notification.status'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.entityType',
          methods: {
            $push: {
              method: '$_id.method',
              status: '$_id.status',
              count: '$count'
            }
          },
          total: { $sum: '$count' }
        }
      }
    ]);

    // Inicializar resumen
    const summary = {
      events: {
        total: 0,
        byMethod: { email: 0, browser: 0, webhook: 0, sms: 0 },
        byStatus: { sent: 0, delivered: 0, failed: 0, pending: 0, retry: 0 }
      },
      tasks: {
        total: 0,
        byMethod: { email: 0, browser: 0, webhook: 0, sms: 0 },
        byStatus: { sent: 0, delivered: 0, failed: 0, pending: 0, retry: 0 }
      },
      movements: {
        total: 0,
        byMethod: { email: 0, browser: 0, webhook: 0, sms: 0 },
        byStatus: { sent: 0, delivered: 0, failed: 0, pending: 0, retry: 0 }
      },
      alerts: {
        total: 0,
        byMethod: { email: 0, browser: 0, webhook: 0, sms: 0 },
        byStatus: { sent: 0, delivered: 0, failed: 0, pending: 0, retry: 0 }
      },
      totalNotifications: 0,
      period: {
        start: query.sentAt.$gte,
        end: query.sentAt.$lte || new Date()
      }
    };

    // Procesar resultados de agregación
    aggregation.forEach(item => {
      const entityType = item._id === 'event' ? 'events' : 
                        item._id === 'task' ? 'tasks' : 
                        item._id === 'movement' ? 'movements' : 
                        item._id === 'alert' ? 'alerts' : null;
      
      if (entityType && summary[entityType]) {
        summary[entityType].total = item.total;
        
        item.methods.forEach(methodData => {
          if (summary[entityType].byMethod[methodData.method] !== undefined) {
            summary[entityType].byMethod[methodData.method] += methodData.count;
          }
          if (summary[entityType].byStatus[methodData.status] !== undefined) {
            summary[entityType].byStatus[methodData.status] += methodData.count;
          }
        });
      }
    });

    // Total general
    summary.totalNotifications = 
      summary.events.total + 
      summary.tasks.total + 
      summary.movements.total + 
      summary.alerts.total;

    // Agregar estadísticas adicionales
    const [failedCount, pendingCount] = await Promise.all([
      NotificationLog.countDocuments({ ...query, 'notification.status': 'failed' }),
      NotificationLog.countDocuments({ ...query, 'notification.status': 'pending' })
    ]);

    summary.stats = {
      failedNotifications: failedCount,
      pendingNotifications: pendingCount,
      successRate: summary.totalNotifications > 0 
        ? ((summary.totalNotifications - failedCount) / summary.totalNotifications * 100).toFixed(2) + '%'
        : '0%'
    };

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    logger.error('Error al obtener resumen de notificaciones:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener resumen de notificaciones'
    });
  }
};

// Obtener historial de alertas del navegador (entregadas)
const getDeliveredAlerts = async (req, res) => {
  try {
    const { 
      userId,
      sourceType, // 'event', 'task', 'movement'
      startDate,
      endDate,
      limit = 100,
      page = 1,
      includeRead = true, // Incluir alertas leídas
      includeUnread = true, // Incluir alertas no leídas
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    const skip = (page - 1) * limit;

    // Construir query base - solo alertas entregadas
    const query = {
      delivered: true
    };
    
    // Filtros opcionales
    if (userId) query.userId = userId;
    if (sourceType) query.sourceType = sourceType;
    
    // Filtrar por estado de lectura
    if (includeRead === 'true' && includeUnread !== 'true') {
      query.read = true;
    } else if (includeRead !== 'true' && includeUnread === 'true') {
      query.read = false;
    }
    // Si ambos son true o false, no filtramos por read
    
    // Filtrar por fechas
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Configurar ordenamiento
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Consultar alertas con información relacionada
    const [alerts, total] = await Promise.all([
      Alert.find(query)
        .populate('userId', 'name email')
        .populate({
          path: 'sourceId',
          select: 'title description dateExpiration dueDate start',
          options: { strictPopulate: false }
        })
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Alert.countDocuments(query)
    ]);

    // Formatear resultados con información adicional
    const formattedAlerts = alerts.map(alert => {
      const formatted = {
        _id: alert._id,
        userId: alert.userId,
        sourceType: alert.sourceType,
        sourceId: alert.sourceId?._id || alert.sourceId,
        sourceDetails: null,
        avatarIcon: alert.avatarIcon,
        primaryText: alert.primaryText,
        secondaryText: alert.secondaryText,
        actionText: alert.actionText,
        expirationDate: alert.expirationDate,
        delivered: alert.delivered,
        read: alert.read,
        createdAt: alert.createdAt,
        deliveryAttempts: alert.deliveryAttempts
      };

      // Agregar detalles de la fuente si está poblada
      if (alert.sourceId && typeof alert.sourceId === 'object') {
        formatted.sourceDetails = {
          title: alert.sourceId.title,
          description: alert.sourceId.description,
          date: alert.sourceId.dateExpiration || alert.sourceId.dueDate || alert.sourceId.start
        };
      }

      return formatted;
    });

    // Estadísticas adicionales
    const stats = {
      totalDelivered: total,
      read: 0,
      unread: 0
    };

    if (includeRead === 'true' && includeUnread === 'true') {
      const [readCount, unreadCount] = await Promise.all([
        Alert.countDocuments({ ...query, read: true }),
        Alert.countDocuments({ ...query, read: false })
      ]);
      stats.read = readCount;
      stats.unread = unreadCount;
    }

    res.json({
      success: true,
      data: formattedAlerts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      },
      stats
    });

  } catch (error) {
    logger.error('Error al obtener historial de alertas:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener historial de alertas',
      message: error.message
    });
  }
};

module.exports = {
  getUpcomingEvents,
  getUpcomingTasks,
  getUpcomingMovements,
  getPendingAlerts,
  getNotificationHistory,
  getNotificationSummary,
  getDeliveredAlerts
};