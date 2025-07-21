const { NotificationLog, Event, Task, Movement } = require('../models');
const logger = require('../config/logger');
const moment = require('moment-timezone');

/**
 * Obtener detalles de una notificación específica
 */
const getNotificationDetail = async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    const notification = await NotificationLog.findById(notificationId)
      .populate('userId', 'name email')
      .lean();
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notificación no encontrada'
      });
    }
    
    // Obtener información adicional de la entidad si existe
    let entity = null;
    try {
      switch (notification.entityType) {
        case 'event':
          entity = await Event.findById(notification.entityId).lean();
          break;
        case 'task':
          entity = await Task.findById(notification.entityId).lean();
          break;
        case 'movement':
          entity = await Movement.findById(notification.entityId).lean();
          break;
      }
    } catch (err) {
      logger.warn(`No se pudo obtener la entidad ${notification.entityType} ${notification.entityId}`);
    }
    
    res.json({
      success: true,
      data: {
        notification,
        currentEntity: entity
      }
    });
    
  } catch (error) {
    logger.error('Error al obtener detalle de notificación:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener detalle de notificación'
    });
  }
};

/**
 * Reintentar envío de notificación fallida
 */
const retryNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    const notification = await NotificationLog.findById(notificationId)
      .populate('userId', 'name email');
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notificación no encontrada'
      });
    }
    
    if (notification.notification.status !== 'failed') {
      return res.status(400).json({
        success: false,
        error: 'Solo se pueden reintentar notificaciones fallidas'
      });
    }
    
    // Actualizar intentos
    notification.notification.delivery.attempts = (notification.notification.delivery.attempts || 0) + 1;
    notification.notification.delivery.lastAttemptAt = new Date();
    notification.notification.status = 'retry';
    
    await notification.save();
    
    // TODO: Implementar lógica de reenvío según el método
    // Por ahora solo actualizamos el estado
    
    res.json({
      success: true,
      message: 'Notificación marcada para reintento',
      data: notification
    });
    
  } catch (error) {
    logger.error('Error al reintentar notificación:', error);
    res.status(500).json({
      success: false,
      error: 'Error al reintentar notificación'
    });
  }
};

/**
 * Obtener notificaciones fallidas
 */
const getFailedNotifications = async (req, res) => {
  try {
    const { 
      limit = 50,
      page = 1,
      userId,
      method,
      startDate,
      endDate
    } = req.query;
    
    const skip = (page - 1) * limit;
    
    const query = {
      'notification.status': { $in: ['failed', 'retry'] }
    };
    
    if (userId) query.userId = userId;
    if (method) query['notification.method'] = method;
    
    if (startDate || endDate) {
      query.sentAt = {};
      if (startDate) query.sentAt.$gte = new Date(startDate);
      if (endDate) query.sentAt.$lte = new Date(endDate);
    }
    
    const [results, total] = await Promise.all([
      NotificationLog.find(query)
        .populate('userId', 'name email')
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      NotificationLog.countDocuments(query)
    ]);
    
    // Agrupar por razón de fallo
    const failureReasons = {};
    results.forEach(log => {
      const reason = log.notification.delivery?.failureReason || 'Unknown';
      failureReasons[reason] = (failureReasons[reason] || 0) + 1;
    });
    
    res.json({
      success: true,
      data: results,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      },
      summary: {
        totalFailed: total,
        failureReasons,
        methods: results.reduce((acc, log) => {
          acc[log.notification.method] = (acc[log.notification.method] || 0) + 1;
          return acc;
        }, {})
      }
    });
    
  } catch (error) {
    logger.error('Error al obtener notificaciones fallidas:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener notificaciones fallidas'
    });
  }
};

/**
 * Obtener duplicados potenciales
 */
const getDuplicateNotifications = async (req, res) => {
  try {
    const { windowSeconds = 5 } = req.query;
    
    // Buscar notificaciones agrupadas por usuario, entidad y tipo
    const duplicates = await NotificationLog.aggregate([
      {
        $group: {
          _id: {
            userId: '$userId',
            entityType: '$entityType',
            entityId: '$entityId',
            method: '$notification.method'
          },
          notifications: {
            $push: {
              _id: '$_id',
              sentAt: '$sentAt',
              status: '$notification.status'
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      },
      {
        $limit: 100
      }
    ]);
    
    // Filtrar por ventana de tiempo
    const filteredDuplicates = duplicates.map(group => {
      const sorted = group.notifications.sort((a, b) => 
        new Date(a.sentAt) - new Date(b.sentAt)
      );
      
      const clusters = [];
      let currentCluster = [sorted[0]];
      
      for (let i = 1; i < sorted.length; i++) {
        const timeDiff = (new Date(sorted[i].sentAt) - new Date(sorted[i-1].sentAt)) / 1000;
        
        if (timeDiff <= windowSeconds) {
          currentCluster.push(sorted[i]);
        } else {
          if (currentCluster.length > 1) {
            clusters.push(currentCluster);
          }
          currentCluster = [sorted[i]];
        }
      }
      
      if (currentCluster.length > 1) {
        clusters.push(currentCluster);
      }
      
      return {
        ...group,
        duplicateClusters: clusters,
        hasDuplicates: clusters.length > 0
      };
    }).filter(group => group.hasDuplicates);
    
    res.json({
      success: true,
      data: filteredDuplicates,
      summary: {
        totalGroups: filteredDuplicates.length,
        totalDuplicates: filteredDuplicates.reduce((acc, group) => 
          acc + group.duplicateClusters.reduce((sum, cluster) => 
            sum + cluster.length - 1, 0), 0
        ),
        windowSeconds
      }
    });
    
  } catch (error) {
    logger.error('Error al obtener duplicados:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener duplicados'
    });
  }
};

/**
 * Limpiar notificaciones antiguas
 */
const cleanOldNotifications = async (req, res) => {
  try {
    const { daysToKeep = 90, dryRun = true } = req.body;
    
    const cutoffDate = moment().subtract(daysToKeep, 'days').toDate();
    
    const query = {
      sentAt: { $lt: cutoffDate },
      'notification.status': { $in: ['sent', 'delivered'] }
    };
    
    const count = await NotificationLog.countDocuments(query);
    
    let deletedCount = 0;
    if (dryRun === false) {
      const result = await NotificationLog.deleteMany(query);
      deletedCount = result.deletedCount;
    }
    
    res.json({
      success: true,
      data: {
        dryRun,
        daysToKeep,
        cutoffDate,
        notificationsToDelete: count,
        deletedCount
      }
    });
    
  } catch (error) {
    logger.error('Error al limpiar notificaciones:', error);
    res.status(500).json({
      success: false,
      error: 'Error al limpiar notificaciones'
    });
  }
};

module.exports = {
  getNotificationDetail,
  retryNotification,
  getFailedNotifications,
  getDuplicateNotifications,
  cleanOldNotifications
};