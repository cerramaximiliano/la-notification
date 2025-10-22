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
      updated: 0,
      duplicates: 0,
      errors: []
    };

    // Hora de notificación por defecto: 9:00 AM
    const defaultNotifyTime = moment().hour(9).minute(0).second(0);
    const notifyAt = notificationTime ? moment(notificationTime).toDate() : defaultNotifyTime.toDate();

    for (const movement of movements) {
      let movementInfo = null; // Para logging de errores

      try {
        const {
          userId,
          expediente,
          movimiento
        } = movement;

        // Validar campos requeridos
        if (!userId) {
          throw new Error('userId es requerido');
        }
        if (!expediente || !expediente.id) {
          throw new Error('expediente.id es requerido');
        }
        if (!movimiento || !movimiento.fecha) {
          throw new Error('movimiento.fecha es requerido');
        }
        if (!movimiento.tipo) {
          throw new Error('movimiento.tipo es requerido');
        }
        if (!movimiento.detalle) {
          throw new Error('movimiento.detalle es requerido');
        }

        // Normalizar fecha a formato YYYY-MM-DD para consistencia en uniqueKey
        let fechaNormalizada;
        try {
          const fechaObj = new Date(movimiento.fecha);
          if (isNaN(fechaObj.getTime())) {
            throw new Error('Fecha inválida');
          }
          fechaNormalizada = fechaObj.toISOString().split('T')[0];
        } catch (dateError) {
          throw new Error(`Error al procesar fecha: ${dateError.message}`);
        }

        // Información para logging
        movementInfo = {
          userId,
          expedienteId: expediente.id,
          expedienteNumber: expediente.number,
          fecha: fechaNormalizada,
          tipo: movimiento.tipo
        };

        // Generar clave única para evitar duplicados (usando fecha normalizada y hash del detalle)
        const uniqueKey = JudicialMovement.generateUniqueKey(
          userId,
          expediente.id,
          fechaNormalizada,
          movimiento.tipo,
          movimiento.detalle
        );

        logger.info(`Procesando movimiento - userId: ${userId}, expediente: ${expediente.id}, fecha: ${fechaNormalizada}, tipo: ${movimiento.tipo}, uniqueKey: ${uniqueKey}`);

        // Verificar si el movimiento ya existe
        const existingMovement = await JudicialMovement.findOne({ uniqueKey });

        if (existingMovement) {
          // El movimiento ya existe - actualizarlo y resetearlo a pending
          logger.info(`Movimiento existente encontrado - _id: ${existingMovement._id}, estado anterior: ${existingMovement.notificationStatus}`);

          existingMovement.expediente = {
            id: expediente.id,
            number: expediente.number,
            year: expediente.year,
            fuero: expediente.fuero,
            caratula: expediente.caratula,
            objeto: expediente.objeto
          };
          existingMovement.movimiento = {
            fecha: new Date(movimiento.fecha),
            tipo: movimiento.tipo,
            detalle: movimiento.detalle,
            url: movimiento.url
          };
          existingMovement.notificationSettings = {
            notifyAt,
            channels: ['email', 'browser']
          };
          // IMPORTANTE: Resetear a pending para que se notifique nuevamente
          existingMovement.notificationStatus = 'pending';
          // Limpiar notificaciones anteriores
          existingMovement.notifications = [];

          await existingMovement.save();

          logger.info(`Movimiento actualizado y reseteado a pending - uniqueKey: ${uniqueKey}, _id: ${existingMovement._id}`);
          results.updated++;
        } else {
          // Movimiento nuevo - crearlo
          const newMovement = await JudicialMovement.create({
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
            uniqueKey,
            notificationStatus: 'pending'
          });

          logger.info(`Movimiento nuevo creado - uniqueKey: ${uniqueKey}, _id: ${newMovement._id}`);
          results.created++;
        }
      } catch (error) {
        if (error.code === 11000) {
          // Error de duplicado
          results.duplicates++;
          logger.warn(`Movimiento duplicado detectado - ${movementInfo ? JSON.stringify(movementInfo) : 'información no disponible'}`);
        } else {
          // Otros errores
          const errorDetail = {
            userId: movement.userId,
            expedienteId: movement.expediente?.id,
            expedienteNumber: movement.expediente?.number,
            fecha: movement.movimiento?.fecha,
            tipo: movement.movimiento?.tipo,
            error: error.message,
            stack: error.stack
          };

          results.errors.push({
            userId: movement.userId,
            expediente: movement.expediente?.id,
            fecha: movement.movimiento?.fecha,
            tipo: movement.movimiento?.tipo,
            error: error.message
          });

          logger.error(`Error procesando movimiento: ${JSON.stringify(errorDetail)}`);
        }
      }
    }

    logger.info(`Movimientos procesados: ${results.created} creados, ${results.updated} actualizados, ${results.duplicates} duplicados, ${results.errors.length} errores`);

    if (results.errors.length > 0) {
      logger.error(`Se encontraron ${results.errors.length} errores procesando movimientos. Ver detalles arriba.`);
    }

    const warnings = [];
    if (results.errors.length > 0) {
      warnings.push(`${results.errors.length} movimientos no pudieron ser procesados. Ver campo 'errors' para detalles.`);
    }
    if (results.updated > 0) {
      warnings.push(`${results.updated} movimientos ya existían y fueron reseteados a 'pending' para re-notificación.`);
    }

    res.json({
      success: true,
      results,
      warnings: warnings.length > 0 ? warnings : null
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