const logger = require('../config/logger');
const crypto = require('crypto');

/**
 * Helper para operaciones atómicas de notificaciones
 * Previene duplicados y garantiza consistencia
 */

/**
 * Genera un ID único para la notificación basado en sus componentes
 */
function generateNotificationId(userId, entityId, type, timestamp = Date.now()) {
  const data = `${userId}-${entityId}-${type}-${timestamp}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Agrega una notificación de forma atómica evitando duplicados
 * @param {Model} Model - Modelo de Mongoose (Event, Task, Movement)
 * @param {Array|String} entityIds - IDs de las entidades a actualizar
 * @param {Object} notificationData - Datos de la notificación
 * @param {Object} options - Opciones adicionales
 * @returns {Object} Resultado de la operación
 */
async function addNotificationAtomic(Model, entityIds, notificationData, options = {}) {
  const {
    windowSeconds = 5,
    userSettings = {},
    session = null
  } = options;

  // Asegurar que entityIds sea un array
  const ids = Array.isArray(entityIds) ? entityIds : [entityIds];
  
  // Generar timestamp consistente
  const now = new Date();
  const windowStart = new Date(now.getTime() - (windowSeconds * 1000));
  
  // Crear objeto de notificación con ID único
  const notification = {
    ...notificationData,
    date: notificationData.date || now,
    notificationId: generateNotificationId(
      notificationData.userId || 'system',
      ids[0], // Usar el primer ID para el hash
      notificationData.type,
      now.getTime()
    )
  };

  try {
    // Primero, inicializar el campo notifications si no existe
    await Model.updateMany(
      {
        _id: { $in: ids },
        notifications: { $exists: false }
      },
      {
        $set: { notifications: [] }
      },
      { session }
    );

    // Luego, hacer la operación atómica con verificación de duplicados
    const result = await Model.updateMany(
      {
        _id: { $in: ids },
        // Verificar que no existe una notificación similar reciente
        $and: [
          {
            $or: [
              // No hay notificaciones
              { notifications: { $size: 0 } },
              // O no hay notificaciones del mismo tipo en la ventana de tiempo
              {
                notifications: {
                  $not: {
                    $elemMatch: {
                      type: notification.type,
                      date: { $gte: windowStart }
                    }
                  }
                }
              }
            ]
          }
        ]
      },
      {
        // Agregar la notificación
        $push: {
          notifications: notification
        },
        // Actualizar configuración si se proporciona
        ...(userSettings && Object.keys(userSettings).length > 0 && {
          $set: { notificationSettings: userSettings }
        }),
        // Actualizar flags según el tipo
        ...(notification.type === 'browser' && {
          $set: { browserAlertSent: true }
        })
      },
      {
        session,
        upsert: false
      }
    );

    if (result.modifiedCount > 0) {
      logger.info(`Notificación agregada exitosamente a ${result.modifiedCount} entidades`);
    } else {
      logger.warn(`No se agregaron notificaciones (posibles duplicados o entidades no encontradas)`);
    }

    return {
      success: true,
      modifiedCount: result.modifiedCount,
      totalCount: ids.length,
      skippedCount: ids.length - result.modifiedCount,
      notification
    };

  } catch (error) {
    logger.error('Error agregando notificación atómica:', error);
    return {
      success: false,
      error: error.message,
      modifiedCount: 0
    };
  }
}

/**
 * Agrega múltiples notificaciones de forma secuencial
 * Útil para evitar condiciones de carrera
 */
async function addNotificationsSequential(Model, items, notificationTemplate, options = {}) {
  const results = {
    total: items.length,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  for (const item of items) {
    try {
      const notificationData = {
        ...notificationTemplate,
        userId: item.userId || notificationTemplate.userId
      };

      const result = await addNotificationAtomic(
        Model,
        item._id,
        notificationData,
        options
      );

      if (result.success) {
        if (result.modifiedCount > 0) {
          results.successful++;
        } else {
          results.skipped++;
        }
      } else {
        results.failed++;
        results.errors.push({
          itemId: item._id,
          error: result.error
        });
      }

    } catch (error) {
      results.failed++;
      results.errors.push({
        itemId: item._id,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Verifica si una notificación ya existe dentro de una ventana de tiempo
 */
async function notificationExists(Model, entityId, type, windowSeconds = 5) {
  const windowStart = new Date(Date.now() - (windowSeconds * 1000));
  
  const entity = await Model.findOne({
    _id: entityId,
    notifications: {
      $elemMatch: {
        type: type,
        date: { $gte: windowStart }
      }
    }
  });

  return !!entity;
}

/**
 * Limpia notificaciones duplicadas de una entidad
 */
async function cleanDuplicateNotifications(Model, entityId, windowSeconds = 5) {
  try {
    const entity = await Model.findById(entityId);
    if (!entity || !entity.notifications || entity.notifications.length === 0) {
      return { removed: 0 };
    }

    const uniqueNotifications = [];
    const seen = new Map();

    // Ordenar por fecha
    const sorted = entity.notifications.sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );

    for (const notification of sorted) {
      const key = `${notification.type}-${notification.method || 'default'}`;
      const lastSeen = seen.get(key);

      if (!lastSeen || 
          new Date(notification.date) - new Date(lastSeen.date) > windowSeconds * 1000) {
        uniqueNotifications.push(notification);
        seen.set(key, notification);
      }
    }

    const removed = entity.notifications.length - uniqueNotifications.length;

    if (removed > 0) {
      entity.notifications = uniqueNotifications;
      await entity.save();
      logger.info(`Eliminadas ${removed} notificaciones duplicadas de ${entityId}`);
    }

    return { removed };

  } catch (error) {
    logger.error('Error limpiando duplicados:', error);
    return { removed: 0, error: error.message };
  }
}

module.exports = {
  generateNotificationId,
  addNotificationAtomic,
  addNotificationsSequential,
  notificationExists,
  cleanDuplicateNotifications
};