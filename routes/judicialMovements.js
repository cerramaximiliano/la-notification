const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { JudicialMovement, User, Folder } = require('../models');
const authMiddleware = require('../middleware/auth');
const moment = require('moment');
const policyService = require('../services/notificationPolicyService');

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
      skipped: 0,
      skippedDeactivated: 0,
      skippedReserved: 0,
      skippedSinCarpeta: 0,
      duplicates: 0,
      errors: []
    };

    // Usuarios desactivados: no crear ni resetear sus movimientos — el cron de
    // notificación los descartaría igual (isActive === false) y solo generan
    // churn diario de docs 'skipped'. Un batch puede traer varios usuarios,
    // se resuelven de una sola vez.
    const batchUserIds = [...new Set(movements.map((mv) => mv && mv.userId).filter(Boolean).map(String))];
    let deactivatedUserIds = new Set();
    try {
      const deactivated = await User.find(
        { _id: { $in: batchUserIds }, isActive: false },
        { _id: 1 }
      ).lean();
      deactivatedUserIds = new Set(deactivated.map((u) => String(u._id)));
      if (deactivatedUserIds.size > 0) {
        logger.info(`Webhook daily-movements: ${deactivatedUserIds.size} usuario(s) desactivado(s) en el batch, sus movimientos se omiten`);
      }
    } catch (lookupError) {
      // Best-effort: si falla el lookup se procesa todo como antes.
      logger.warn(`Webhook daily-movements: no se pudo resolver usuarios desactivados: ${lookupError.message}`);
    }

    // Causas reservadas sin cobertura (2026-09-28): la carpeta del usuario tiene
    // causaCredentialCovered:false (su credencial PJN cayó o nunca cubrió la
    // causa). El cron las descartaría igual ('Causa reservada: credencial sin
    // cobertura'), pero crear el doc pending genera churn y lo deja visible en
    // GET /pending/:userId hasta la próxima corrida (varios días si cae en día
    // no activo). Un solo find por batch; best-effort como el de desactivados.
    let reservedPairs = new Set();
    try {
      const reserved = await Folder.find(
        { userId: { $in: batchUserIds }, causaCredentialCovered: false, causaId: { $ne: null } },
        { userId: 1, causaId: 1 }
      ).lean();
      reservedPairs = new Set(reserved.map((f) => `${f.userId}|${f.causaId}`));
      if (reservedPairs.size > 0) {
        logger.info(`Webhook daily-movements: ${reservedPairs.size} par(es) usuario|causa reservada sin cobertura en el batch, sus movimientos PJN se omiten`);
      }
    } catch (lookupError) {
      logger.warn(`Webhook daily-movements: no se pudo resolver carpetas sin cobertura: ${lookupError.message}`);
    }

    // Usuario sin carpeta de la causa (2026-09-29): con limits.requireFolderForDelivery
    // el envío ya los descarta ('el usuario no tiene esta causa en su cuenta'); acá no se
    // crea el pending. Cubre también la brecha del filtro de reservadas, que mira la
    // carpeta: sin carpeta no hay causaCredentialCovered que evaluar. Best-effort.
    let paresConCarpeta = null;
    try {
      const cfg = await policyService.getConfigCached();
      if (cfg?.limits?.requireFolderForDelivery === true) {
        const causaIds = [...new Set(movements.map((mv) => mv && mv.expediente && mv.expediente.id).filter(Boolean).map(String))];
        const conCarpeta = await Folder.find(
          { userId: { $in: batchUserIds }, causaId: { $in: causaIds } },
          { userId: 1, causaId: 1 }
        ).lean();
        paresConCarpeta = new Set(conCarpeta.map((f) => `${f.userId}|${f.causaId}`));
      }
    } catch (lookupError) {
      logger.warn(`Webhook daily-movements: no se pudo resolver carpetas del batch: ${lookupError.message}`);
      paresConCarpeta = null;
    }

    // Hora de notificación: usar la recibida o por defecto 9:00 AM
    const defaultNotifyTime = moment().hour(9).minute(0).second(0);
    let notifyAt = notificationTime ? moment(notificationTime).toDate() : defaultNotifyTime.toDate();

    // Si el notifyAt que mandó la fuente ya venció, lo recalculamos contra el
    // horario configurado en vez de poner "ahora".
    //
    // Antes esto era `notifyAt = now`, y por eso un movimiento detectado de
    // madrugada se notificaba de madrugada: los workers corren todo el día y la
    // hora del payload casi siempre llega vencida (pjn-mis-causas manda un fijo
    // de las 13:00 ART que para cualquier envío posterior ya pasó). Ahora, antes
    // del slot del día se espera al slot; después del slot se entrega igual en
    // la próxima corrida (mismo día, hora razonable); y en día no activo se
    // espera al próximo día activo.
    const now = new Date();
    if (notifyAt < now) {
      const config = await policyService.getConfigCached();
      const recalculado = policyService.getDeliveryNotifyAt(config, now);
      logger.info(`⏰ Hora de notificación ${notifyAt.toISOString()} ya pasó, reprogramando a ${recalculado.toISOString()}`);
      notifyAt = recalculado;
    }

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
        if (deactivatedUserIds.has(String(userId))) {
          results.skippedDeactivated++;
          continue;
        }
        if (!expediente || !expediente.id) {
          throw new Error('expediente.id es requerido');
        }
        // Solo fuente PJN (default): las cédulas y otras fuentes no pasan por cobertura.
        if ((movement.source || 'pjn') === 'pjn' && reservedPairs.has(`${userId}|${expediente.id}`)) {
          results.skippedReserved++;
          continue;
        }
        if (paresConCarpeta && !paresConCarpeta.has(`${userId}|${expediente.id}`)) {
          results.skippedSinCarpeta++;
          continue;
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
          // El movimiento ya existe — dos caminos según su estado:
          //   - sent: NO re-notificar (evita emails duplicados cuando un worker
          //     re-detecta el mismo movimiento por cambio de key, backfill o
          //     limpieza administrativa). Sólo refrescamos metadata por si
          //     detalle/url/caratula cambió.
          //   - skipped por "Causa reservada: credencial sin cobertura": mismo
          //     tratamiento que sent — NO se resucita a pending; el usuario no
          //     tiene credencial que cubra la causa y volver a encolarlo solo
          //     lo haría caer de nuevo en skipped (o notificarlo si el enforcement
          //     no lo viera). Los otros motivos de skipped sí se resetean.
          //   - pending / failed: resetear para que el procesador lo reintente.
          logger.info(`Movimiento existente encontrado - _id: ${existingMovement._id}, estado anterior: ${existingMovement.notificationStatus}`);
          const skippedReserved = existingMovement.notificationStatus === 'skipped'
            && Array.isArray(existingMovement.notifications)
            && existingMovement.notifications.some((n) => typeof n?.details === 'string' && n.details.startsWith('Causa reservada'));

          existingMovement.expediente = {
            id: expediente.id,
            number: expediente.number,
            year: expediente.year,
            label: expediente.label || undefined,
            fuero: expediente.fuero,
            caratula: expediente.caratula,
            objeto: expediente.objeto
          };
          existingMovement.movimiento = {
            fecha: new Date(movimiento.fecha),
            tipo: movimiento.tipo,
            detalle: movimiento.detalle,
            url: movimiento.url,
            posicionDia: Number.isFinite(movimiento.posicionDia) ? movimiento.posicionDia : undefined,
            sourceRef: movimiento.sourceRef,
            hasPdf: movimiento.hasPdf,
            esSentencia: movimiento.esSentencia
          };
          if (movement.source) {
            existingMovement.source = movement.source;
          }

          if (existingMovement.notificationStatus === 'sent') {
            // Ya notificado con éxito — mantener estado, solo persistir metadata.
            await existingMovement.save();
            logger.info(`Movimiento ya notificado — skip re-envío - uniqueKey: ${uniqueKey}`);
            results.skipped++;
          } else if (skippedReserved) {
            // Descartado por causa reservada sin cobertura — mantener estado, solo persistir metadata.
            await existingMovement.save();
            logger.info(`Movimiento descartado por causa reservada sin cobertura — no se resucita - uniqueKey: ${uniqueKey}`);
            results.skippedReserved++;
          } else {
            existingMovement.notificationSettings = {
              notifyAt,
              channels: ['email', 'browser']
            };
            existingMovement.notificationStatus = 'pending';
            existingMovement.notifications = [];
            await existingMovement.save();
            logger.info(`Movimiento reseteado a pending para reintento - uniqueKey: ${uniqueKey}, _id: ${existingMovement._id}`);
            results.updated++;
          }
        } else {
          // Movimiento nuevo - crearlo
          const newMovement = await JudicialMovement.create({
            userId,
            expediente: {
              id: expediente.id,
              number: expediente.number,
              year: expediente.year,
              label: expediente.label || undefined,
              fuero: expediente.fuero,
              caratula: expediente.caratula,
              objeto: expediente.objeto
            },
            movimiento: {
              fecha: new Date(movimiento.fecha),
              tipo: movimiento.tipo,
              detalle: movimiento.detalle,
              url: movimiento.url,
              posicionDia: Number.isFinite(movimiento.posicionDia) ? movimiento.posicionDia : undefined,
              sourceRef: movimiento.sourceRef,
              hasPdf: movimiento.hasPdf,
              esSentencia: movimiento.esSentencia
            },
            source: movement.source || 'pjn',
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

    logger.info(`Movimientos procesados: ${results.created} creados, ${results.updated} actualizados, ${results.duplicates} duplicados, ${results.skippedDeactivated} de usuarios desactivados, ${results.skippedReserved} de causas reservadas sin cobertura, ${results.errors.length} errores`);

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