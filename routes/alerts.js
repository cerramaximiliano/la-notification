const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const {
  createCustomAlert,
  createBulkAlerts,
  getPendingAlerts,
  markAlertAsRead,
  cleanupAlerts
} = require('../controllers/alertController');

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

// Crear alerta personalizada para usuarios específicos
router.post('/create', isAdmin, createCustomAlert);

// Crear alertas masivas con filtros
router.post('/bulk', isAdmin, createBulkAlerts);

// Obtener alertas pendientes de cualquier usuario (admin)
router.get('/pending/:userId', isAdmin, getPendingAlerts);

// Limpiar alertas antiguas
router.delete('/cleanup', isAdmin, cleanupAlerts);

module.exports = router;