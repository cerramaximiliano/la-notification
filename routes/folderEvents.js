const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { verifyServiceToken } = require('../middleware/auth');

/**
 * Recibe folders recién creados desde workers de sincronización PJN
 * y los emite en tiempo real al cliente del usuario via WebSocket.
 *
 * No persiste nada: es un pass-through hacia el canal WS del usuario.
 */
router.post('/created', verifyServiceToken, (req, res) => {
  try {
    const { userId, folders } = req.body;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, message: 'userId requerido' });
    }

    if (!Array.isArray(folders) || folders.length === 0) {
      return res.status(400).json({ success: false, message: 'folders debe ser un array no vacío' });
    }

    const io = global.io;

    if (!io) {
      logger.warn('folder-events: global.io no disponible, evento no emitido');
      return res.json({ success: true, emitted: false });
    }

    io.to(`user-${userId}`).emit('folders_created', folders);

    logger.info(`folder-events: ${folders.length} folder(s) emitidos al usuario ${userId}`);

    return res.json({ success: true, emitted: true, count: folders.length });

  } catch (error) {
    logger.error(`folder-events: error procesando evento: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Error interno' });
  }
});

module.exports = router;
