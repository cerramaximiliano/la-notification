const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { JudicialMovement, User } = require('../models');
const authMiddleware = require('../middleware/auth');
const moment = require('moment');

/**
 * Webhook para recibir movimientos judiciales del día
 * El servicio principal enviará los movimientos que coincidan con la fecha actual
 */
router.post('/webhook/daily-movements', authMiddleware.verifyServiceToken, async (req, res) => {
  try {
    const { movements, notificationTime } = req.body;
    
    if (!movements || !Array.isArray(movements)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Se requiere un array de movimientos' 
      });
    }

    logger.info(`Recibiendo ${movements.length} movimientos judiciales para notificar`);
    
    const results = {
      received: movements.length,
      created: 0,
      duplicates: 0,
      errors: []
    };

    // Hora de notificación por defecto: 9:00 AM
    const defaultNotifyTime = moment().hour(9).minute(0).second(0);
    const notifyAt = notificationTime ? moment(notificationTime).toDate() : defaultNotifyTime.toDate();

    for (const movement of movements) {
      try {
        const {
          userId,
          expediente,
          movimiento
        } = movement;

        // Generar clave única para evitar duplicados
        const uniqueKey = JudicialMovement.generateUniqueKey(
          userId,
          expediente.id,
          movimiento.fecha,
          movimiento.tipo
        );

        // Crear o actualizar el movimiento judicial
        await JudicialMovement.findOneAndUpdate(
          { uniqueKey },
          {
            userId,
            expediente: {
              id: expediente.id,
              number: expediente.number,
              year: expediente.year,
              fuero: expediente.fuero,
              caratula: expediente.caratula,
              objeto: expediente.objeto
            },
            movimiento: {
              fecha: new Date(movimiento.fecha),
              tipo: movimiento.tipo,
              detalle: movimiento.detalle,
              url: movimiento.url
            },
            notificationSettings: {
              notifyAt,
              channels: ['email', 'browser']
            },
            uniqueKey
          },
          { 
            upsert: true, 
            new: true,
            setDefaultsOnInsert: true
          }
        );

        results.created++;
      } catch (error) {
        if (error.code === 11000) {
          results.duplicates++;
        } else {
          results.errors.push({
            expediente: movement.expediente?.id,
            error: error.message
          });
        }
      }
    }

    logger.info(`Movimientos procesados: ${results.created} creados, ${results.duplicates} duplicados`);

    res.json({
      success: true,
      results
    });

  } catch (error) {
    logger.error('Error procesando movimientos judiciales:', error);
    res.status(500).json({
      success: false,
      message: 'Error procesando movimientos',
      error: error.message
    });
  }
});

/**
 * Endpoint para consultar movimientos pendientes de notificar
 */
router.get('/pending/:userId', authMiddleware.authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Verificar que el usuario tenga acceso
    if (req.user._id.toString() !== userId) {
      return res.status(403).json({ 
        success: false, 
        message: 'No autorizado' 
      });
    }

    const pendingMovements = await JudicialMovement.find({
      userId,
      notificationStatus: 'pending'
    }).sort({ 'notificationSettings.notifyAt': 1 });

    res.json({
      success: true,
      count: pendingMovements.length,
      movements: pendingMovements
    });

  } catch (error) {
    logger.error('Error obteniendo movimientos pendientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo movimientos',
      error: error.message
    });
  }
});

/**
 * Marcar un movimiento como notificado manualmente
 */
router.post('/:movementId/mark-notified', authMiddleware.authenticate, async (req, res) => {
  try {
    const { movementId } = req.params;
    
    const movement = await JudicialMovement.findById(movementId);
    
    if (!movement) {
      return res.status(404).json({ 
        success: false, 
        message: 'Movimiento no encontrado' 
      });
    }
    
    // Verificar que el usuario tenga acceso
    if (movement.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'No autorizado' 
      });
    }

    movement.notificationStatus = 'sent';
    movement.notifications.push({
      date: new Date(),
      type: 'manual',
      success: true,
      details: 'Marcado como notificado manualmente'
    });
    
    await movement.save();

    res.json({
      success: true,
      message: 'Movimiento marcado como notificado'
    });

  } catch (error) {
    logger.error('Error marcando movimiento como notificado:', error);
    res.status(500).json({
      success: false,
      message: 'Error actualizando movimiento',
      error: error.message
    });
  }
});

module.exports = router;