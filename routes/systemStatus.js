/**
 * Endpoints para broadcast de estado del sistema (cross-cutting).
 *
 * Pensado para que los workers de scraping (pjn-workers) notifiquen
 * cambios globales como el estado del portal del PJN. El frontend escucha
 * el evento socket 'system_status' y actualiza Redux para deshabilitar UI
 * que no funcionará durante el mantenimiento, sin esperar al próximo
 * polling ni a que el usuario tropiece con un 503.
 *
 * No persiste nada: es un pass-through al canal socket global. El estado
 * canónico vive en ManagerConfig (Mongo, en pjn-models) y los clientes
 * pueden hacer hydration vía REST en law-analytics-server.
 */

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { verifyServiceToken } = require('../middleware/auth');

const VALID_TYPES = ['PJN_SITE_STATUS', 'SCBA_SITE_STATUS'];

/**
 * POST /api/system-status/broadcast
 *
 * Body: { type: string, payload: object }
 * Auth: Bearer INTERNAL_SERVICE_TOKEN
 *
 * Emite a TODOS los sockets conectados — es estado global, no por usuario.
 */
router.post('/broadcast', verifyServiceToken, (req, res) => {
  try {
    const { type, payload } = req.body;

    if (!type || typeof type !== 'string') {
      return res.status(400).json({ success: false, message: 'type requerido' });
    }

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `type inválido (esperado: ${VALID_TYPES.join(' | ')})`
      });
    }

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ success: false, message: 'payload requerido' });
    }

    const io = global.io;
    if (!io) {
      logger.warn('system-status: global.io no disponible, evento no emitido');
      return res.json({ success: true, emitted: false });
    }

    const message = {
      type,
      payload,
      timestamp: new Date().toISOString()
    };

    io.emit('system_status', message);

    logger.info(`system-status: broadcast emitido (type: ${type})`);
    return res.json({ success: true, emitted: true });

  } catch (error) {
    logger.error(`system-status: error procesando: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Error interno' });
  }
});

module.exports = router;
