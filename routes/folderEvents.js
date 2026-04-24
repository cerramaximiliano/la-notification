const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { verifyServiceToken } = require('../middleware/auth');

const VALID_SOURCES = ['pjn', 'scba'];

/**
 * Recibe folders recién creados desde workers de sincronización (PJN o SCBA)
 * y los emite en tiempo real al cliente del usuario via WebSocket.
 *
 * Payload: { userId, folders, source?: 'pjn' | 'scba' }  (source default 'pjn')
 *
 * No persiste nada: es un pass-through hacia el canal WS del usuario.
 */
router.post('/created', verifyServiceToken, (req, res) => {
  try {
    const { userId, folders, source = 'pjn' } = req.body;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, message: 'userId requerido' });
    }

    if (!Array.isArray(folders) || folders.length === 0) {
      return res.status(400).json({ success: false, message: 'folders debe ser un array no vacío' });
    }

    if (!VALID_SOURCES.includes(source)) {
      return res.status(400).json({ success: false, message: `source inválido (esperado: ${VALID_SOURCES.join(' | ')})` });
    }

    const io = global.io;

    if (!io) {
      logger.warn('folder-events: global.io no disponible, evento no emitido');
      return res.json({ success: true, emitted: false });
    }

    io.to(`user-${userId}`).emit('folders_created', { folders, source });

    logger.info(`folder-events: ${folders.length} folder(s) emitidos al usuario ${userId} (source: ${source})`);

    return res.json({ success: true, emitted: true, count: folders.length });

  } catch (error) {
    logger.error(`folder-events: error procesando evento: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Error interno' });
  }
});

module.exports = router;
