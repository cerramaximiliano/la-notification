const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { verifyServiceToken } = require('../middleware/auth');

const VALID_SOURCES = ['pjn', 'scba'];

/**
 * Recibe actualizaciones de progreso de sincronización desde workers (PJN o SCBA)
 * y las emite en tiempo real al cliente del usuario via WebSocket.
 *
 * Payload: { userId, progress, source?: 'pjn' | 'scba' }  (source default 'pjn')
 * El frontend discrimina por `progress.source` para despachar al reducer correcto.
 *
 * No persiste nada: es un pass-through hacia el canal WS del usuario.
 */
router.post('/update', verifyServiceToken, (req, res) => {
  try {
    const { userId, progress, source = 'pjn' } = req.body;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, message: 'userId requerido' });
    }

    if (!progress || typeof progress !== 'object') {
      return res.status(400).json({ success: false, message: 'progress requerido' });
    }

    if (!VALID_SOURCES.includes(source)) {
      return res.status(400).json({ success: false, message: `source inválido (esperado: ${VALID_SOURCES.join(' | ')})` });
    }

    const io = global.io;

    if (!io) {
      logger.warn('sync-progress: global.io no disponible, evento no emitido');
      return res.json({ success: true, emitted: false });
    }

    io.to(`user-${userId}`).emit('sync_progress', { ...progress, source });

    logger.debug(`sync-progress: progreso emitido al usuario ${userId} (source: ${source}, phase: ${progress.phase}, progress: ${progress.progress}%)`);

    return res.json({ success: true, emitted: true });

  } catch (error) {
    logger.error(`sync-progress: error procesando: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Error interno' });
  }
});

module.exports = router;
