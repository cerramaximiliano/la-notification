const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { verifyServiceToken } = require('../middleware/auth');

const ALLOWED_CRED_STATUSES = ['checking', 'validated', 'invalid'];
const ALLOWED_SOL_STATUSES  = ['pending', 'processing', 'submitted', 'completed', 'error', 'dry_run_completed'];

/**
 * Eventos en tiempo real del módulo SECLO (audiencias del Ministerio de Trabajo).
 *
 * Lo emite el `trabajo-worker` (process trabajo-manager en worker_02) cuando:
 *   - Cambia el estado de validación de la credencial del usuario
 *   - Cambia el estado de una solicitud (processing/submitted/completed/error)
 *   - Se obtiene el conciliador post-audiencia
 *
 * Patrón espejo de `folderEvents.js` y `syncProgress.js`. No persiste nada;
 * es pass-through hacia el room WS privado del usuario (`user-${userId}`).
 */

/**
 * POST /api/seclo-events/credential-update
 * Body: { userId, status: 'checking'|'validated'|'invalid', credential?, reason?, source? }
 * Emite evento `seclo_credential_update`.
 */
router.post('/credential-update', verifyServiceToken, (req, res) => {
  try {
    const { userId, status, credential, reason, source = 'seclo' } = req.body;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, message: 'userId requerido' });
    }
    if (!ALLOWED_CRED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `status inválido (esperado: ${ALLOWED_CRED_STATUSES.join(' | ')})` });
    }

    const io = global.io;
    if (!io) {
      logger.warn('seclo-events: global.io no disponible, credential-update no emitido');
      return res.json({ success: true, emitted: false });
    }

    io.to(`user-${userId}`).emit('seclo_credential_update', { status, credential, reason, source });

    logger.debug(`seclo-events: credential-update ${status} emitido al usuario ${userId}`);
    return res.json({ success: true, emitted: true });

  } catch (error) {
    logger.error(`seclo-events: error en credential-update: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Error interno' });
  }
});

/**
 * POST /api/seclo-events/solicitud-update
 * Body: { userId, solicitudId, status, numeroExpediente?, numeroTramite?, audiencia?, error?, source? }
 * Emite evento `seclo_solicitud_update`.
 */
router.post('/solicitud-update', verifyServiceToken, (req, res) => {
  try {
    const { userId, solicitudId, status, numeroExpediente, numeroTramite, audiencia, error, source = 'seclo' } = req.body;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, message: 'userId requerido' });
    }
    if (!solicitudId || typeof solicitudId !== 'string') {
      return res.status(400).json({ success: false, message: 'solicitudId requerido' });
    }
    if (!ALLOWED_SOL_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `status inválido (esperado: ${ALLOWED_SOL_STATUSES.join(' | ')})` });
    }

    const io = global.io;
    if (!io) {
      logger.warn('seclo-events: global.io no disponible, solicitud-update no emitido');
      return res.json({ success: true, emitted: false });
    }

    io.to(`user-${userId}`).emit('seclo_solicitud_update', {
      solicitudId, status, numeroExpediente, numeroTramite, audiencia, error, source,
    });

    logger.debug(`seclo-events: solicitud ${solicitudId} → ${status} emitido al usuario ${userId}`);
    return res.json({ success: true, emitted: true });

  } catch (err) {
    logger.error(`seclo-events: error en solicitud-update: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Error interno' });
  }
});

module.exports = router;
