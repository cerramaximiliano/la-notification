const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const {
  getUpcomingEvents,
  getUpcomingTasks,
  getUpcomingMovements,
  getPendingAlerts,
  getNotificationHistory,
  getNotificationSummary,
  getDeliveredAlerts
} = require('../controllers/monitoringController');
const {
  getNotificationDetail,
  retryNotification,
  getFailedNotifications,
  getDuplicateNotifications,
  cleanOldNotifications
} = require('../controllers/notificationManagementController');
const {
  executeCronJob,
  executeAllCronJobs
} = require('../controllers/cronController');

// Todas las rutas requieren autenticación
router.use(verifyToken);

// Rutas para administradores - requieren permisos de admin
//router.use(isAdmin);

// Obtener eventos próximos a notificar
// GET /api/monitoring/events/upcoming?days=7&limit=100&page=1
router.get('/events/upcoming', getUpcomingEvents);

// Obtener tareas próximas a notificar
// GET /api/monitoring/tasks/upcoming?days=7&limit=100&page=1
router.get('/tasks/upcoming', getUpcomingTasks);

// Obtener movimientos próximos a notificar
// GET /api/monitoring/movements/upcoming?days=7&limit=100&page=1
router.get('/movements/upcoming', getUpcomingMovements);

// Obtener alertas pendientes de entrega
// GET /api/monitoring/alerts/pending?userId=xxx&limit=100&page=1
router.get('/alerts/pending', getPendingAlerts);

// Obtener historial de alertas entregadas
// GET /api/monitoring/alerts/delivered?userId=xxx&sourceType=movement&includeRead=true&includeUnread=true
router.get('/alerts/delivered', getDeliveredAlerts);

// Obtener historial de notificaciones
// GET /api/monitoring/history?type=event&userId=xxx&startDate=2024-01-01&endDate=2024-12-31&limit=100&page=1
router.get('/history', getNotificationHistory);

// Obtener resumen de notificaciones
// GET /api/monitoring/summary?startDate=2024-01-01&endDate=2024-12-31
router.get('/summary', getNotificationSummary);

// Rutas adicionales para gestión de notificaciones

// IMPORTANTE: Las rutas estáticas deben ir ANTES que las rutas con parámetros

// Obtener notificaciones fallidas
// GET /api/monitoring/notifications/failed?limit=50&page=1
router.get('/notifications/failed', getFailedNotifications);

// Obtener duplicados potenciales
// GET /api/monitoring/notifications/duplicates?windowSeconds=5
router.get('/notifications/duplicates', getDuplicateNotifications);

// Obtener detalle de una notificación específica
// GET /api/monitoring/notifications/:notificationId
router.get('/notifications/:notificationId', getNotificationDetail);

// Reintentar notificación fallida
// POST /api/monitoring/notifications/:notificationId/retry
router.post('/notifications/:notificationId/retry', retryNotification);

// Limpiar notificaciones antiguas (requiere confirmación)
// POST /api/monitoring/notifications/clean
router.post('/notifications/clean', cleanOldNotifications);

// Rutas para ejecutar trabajos cron manualmente (solo admin)
// POST /api/monitoring/cron/execute
router.post('/cron/execute', isAdmin, executeCronJob);

// POST /api/monitoring/cron/execute-all
router.post('/cron/execute-all', isAdmin, executeAllCronJobs);

module.exports = router;