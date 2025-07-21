/**
 * Generador de IDs de notificación compartido
 * Usar en todos los microservicios para mantener consistencia
 */

const crypto = require('crypto');

/**
 * Genera un ID único para notificaciones
 * Debe ser idéntico al usado en notificationHelper.js
 */
function generateNotificationId(userId, entityId, type, timestamp = Date.now()) {
  const data = `${userId}-${entityId}-${type}-${timestamp}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Crea un objeto de notificación con ID único
 */
function createNotification(data) {
  const {
    userId,
    entityId,
    type = 'email',
    success = true,
    details = '',
    date = new Date()
  } = data;

  return {
    date,
    type,
    success,
    details,
    notificationId: generateNotificationId(userId, entityId, type, date.getTime())
  };
}

module.exports = {
  generateNotificationId,
  createNotification
};