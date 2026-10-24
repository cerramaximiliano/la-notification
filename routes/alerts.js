const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin, verifyServiceOrAdmin } = require('../middleware/auth');
const {
  createCustomAlert,
  createBulkAlerts,
  getPendingAlerts,
  markAlertAsRead,
  cleanupAlerts
} = require('../controllers/alertController');

// Crear alerta personalizada para usuarios específicos. Va ANTES del
// verifyToken global: la usan los workers con el token de servicio (alertas de
// sistema como "carpetas archivadas por plan" o "causas SCBA completas") además
// de los admins con JWT.
router.post('/create', verifyServiceOrAdmin, createCustomAlert);

// Middleware de autenticación para todas las rutas
router.use(verifyToken);

// Rutas públicas (cualquier usuario autenticado)

// Obtener alertas pendientes del usuario actual
router.get('/pending', async (req, res) => {
  req.params.userId = req.userId;
  return getPendingAlerts(req, res);
});

// Marcar alerta como leída
router.put('/:alertId/read', markAlertAsRead);

// Rutas administrativas (requieren permisos de admin)

// Crear alertas masivas con filtros
router.post('/bulk', isAdmin, createBulkAlerts);

// Obtener alertas pendientes de cualquier usuario (admin)
router.get('/pending/:userId', isAdmin, getPendingAlerts);

// Limpiar alertas antiguas
router.delete('/cleanup', isAdmin, cleanupAlerts);

module.exports = router;