const { Alert, User, NotificationLog } = require('../models');
const logger = require('../config/logger');
const websocketService = require('../services/websocket');
const mongoose = require('mongoose');

/**
 * Crear una alerta personalizada para uno o varios usuarios
 * 
 * @route POST /api/alerts/create
 * @body {
 *   userIds: string[], // Array de IDs de usuarios
 *   alert: {
 *     folderId?: string, // Opcional
 *     sourceType?: string, // 'event', 'task', 'movement', 'system', 'marketing', 'custom'
 *     sourceId?: string, // ID de la entidad relacionada
 *     avatarType?: string,
 *     avatarIcon?: string,
 *     avatarSize?: number,
 *     avatarInitial?: string,
 *     primaryText?: string,
 *     primaryVariant?: string,
 *     secondaryText: string, // Requerido
 *     actionText: string, // Requerido
 *     expirationDate?: Date,
 *     deliverImmediately?: boolean // Si true, intenta entregar por WebSocket inmediatamente
 *   },
 *   campaign?: { // Opcional - para email marketing
 *     name: string,
 *     type: string,
 *     trackingId: string
 *   }
 * }
 */
const createCustomAlert = async (req, res) => {
  try {
    const { userIds, alert, campaign, deliverImmediately = true } = req.body;

    // Validaciones básicas
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere al menos un ID de usuario'
      });
    }

    if (!alert || !alert.secondaryText || !alert.actionText) {
      return res.status(400).json({
        success: false,
        error: 'Los campos secondaryText y actionText son requeridos'
      });
    }

    // Verificar que los usuarios existan
    const validUsers = await User.find({
      _id: { $in: userIds },
      active: { $ne: false }
    }).select('_id email name preferences');

    if (validUsers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No se encontraron usuarios válidos'
      });
    }

    logger.info(`Creando alertas personalizadas para ${validUsers.length} usuarios`);

    // Preparar datos de la alerta
    const alertData = {
      ...alert,
      delivered: false,
      read: false,
      deliveryAttempts: 0,
      sourceType: alert.sourceType || 'custom' // Por defecto es 'custom' para alertas manuales
    };

    // Validar sourceId si se proporciona sourceType
    if (alert.sourceType && alert.sourceId) {
      // Validar que el sourceId sea un ObjectId válido
      if (!mongoose.Types.ObjectId.isValid(alert.sourceId)) {
        return res.status(400).json({
          success: false,
          error: 'sourceId debe ser un ObjectId válido'
        });
      }
      
      // Opcionalmente, validar que la entidad existe
      try {
        let exists = false;
        switch (alert.sourceType) {
          case 'event':
            const Event = require('../models/Event');
            exists = await Event.exists({ _id: alert.sourceId });
            break;
          case 'task':
            const Task = require('../models/Task');
            exists = await Task.exists({ _id: alert.sourceId });
            break;
          case 'movement':
            const Movement = require('../models/Movement');
            exists = await Movement.exists({ _id: alert.sourceId });
            break;
          default:
            // Para system, marketing, custom no validamos
            exists = true;
        }
        
        if (!exists) {
          logger.warn(`sourceId ${alert.sourceId} no encontrado para tipo ${alert.sourceType}`);
          // Opcional: decidir si esto es un error o solo un warning
        }
      } catch (error) {
        logger.error(`Error validando sourceId: ${error.message}`);
      }
    }

    // Agregar información de campaña si existe
    const metadata = {};
    if (campaign) {
      metadata.campaign = campaign;
      metadata.source = 'custom_alert';
      metadata.createdBy = req.userId || 'system';
    }

    // Crear alertas y registrar en NotificationLog
    const results = {
      created: [],
      delivered: [],
      failed: []
    };

    for (const user of validUsers) {
      try {
        // Crear la alerta
        const newAlert = await Alert.create({
          userId: user._id,
          ...alertData
        });

        results.created.push({
          userId: user._id,
          alertId: newAlert._id,
          email: user.email
        });

        // Registrar en NotificationLog
        await NotificationLog.create({
          userId: user._id,
          entityType: 'alert',
          entityId: newAlert._id,
          entitySnapshot: {
            secondaryText: newAlert.secondaryText,
            actionText: newAlert.actionText,
            expirationDate: newAlert.expirationDate
          },
          sentAt: new Date(),
          scheduledFor: new Date(),
          notification: {
            method: 'browser',
            status: deliverImmediately ? 'pending' : 'created',
            content: {
              subject: newAlert.primaryText || 'Nueva alerta',
              message: newAlert.secondaryText,
              data: {
                alertId: newAlert._id,
                ...alertData
              }
            },
            delivery: {
              attempts: 0,
              recipientEmail: user.email
            }
          },
          config: {
            deliverImmediately,
            source: 'custom_alert'
          },
          metadata
        });

        // Intentar entregar inmediatamente si está configurado
        if (deliverImmediately) {
          const isConnected = websocketService.isUserConnected(user._id.toString());
          logger.info(`Usuario ${user.email} conectado por WebSocket: ${isConnected}`);
          
          if (isConnected) {
            try {
              await websocketService.sendPushAlert(user._id.toString(), newAlert);
              
              // Actualizar el estado de entrega
              await Alert.findByIdAndUpdate(newAlert._id, {
                delivered: true,
                deliveryAttempts: 1,
                lastDeliveryAttempt: new Date()
              });

            // Actualizar NotificationLog
            await NotificationLog.updateOne(
              { entityId: newAlert._id },
              {
                'notification.status': 'delivered',
                'notification.delivery.deliveredAt': new Date(),
                'notification.delivery.attempts': 1,
                'notification.delivery.lastAttemptAt': new Date()
              }
            );

            results.delivered.push({
              userId: user._id,
              alertId: newAlert._id,
              email: user.email
            });

              logger.info(`Alerta entregada inmediatamente al usuario ${user.email}`);
            } catch (wsError) {
              logger.error(`Error al entregar alerta por WebSocket: ${wsError.message}`);
            }
          } else {
            logger.info(`Usuario ${user.email} no está conectado por WebSocket, la alerta queda pendiente`);
          }
        }

      } catch (error) {
        logger.error(`Error al crear alerta para usuario ${user._id}: ${error.message}`);
        results.failed.push({
          userId: user._id,
          email: user.email,
          error: error.message
        });
      }
    }

    // Resumen de resultados
    const summary = {
      success: true,
      summary: {
        total: validUsers.length,
        created: results.created.length,
        delivered: results.delivered.length,
        pending: results.created.length - results.delivered.length,
        failed: results.failed.length
      },
      details: {
        created: results.created,
        delivered: results.delivered,
        failed: results.failed
      }
    };

    logger.info(`Proceso de creación de alertas completado: ${JSON.stringify(summary.summary)}`);

    res.json(summary);

  } catch (error) {
    logger.error('Error al crear alertas personalizadas:', error);
    res.status(500).json({
      success: false,
      error: 'Error al crear alertas personalizadas',
      message: error.message
    });
  }
};

/**
 * Crear alertas masivas con plantilla
 * 
 * @route POST /api/alerts/bulk
 * @body {
 *   filter: { // Filtros para seleccionar usuarios
 *     role?: string,
 *     active?: boolean,
 *     subscriptionPlan?: string,
 *     // otros filtros...
 *   },
 *   template: { // Plantilla de alerta
 *     folderId?: string, // Opcional
 *     sourceType?: string, // 'system', 'marketing', etc.
 *     avatarType?: string,
 *     avatarIcon?: string,
 *     avatarSize?: number,
 *     primaryText?: string,
 *     primaryVariant?: string,
 *     secondaryText: string,
 *     actionText: string,
 *     expirationDate?: Date,
 *     // Soporta variables: {{name}}, {{email}}, etc.
 *   },
 *   options: {
 *     deliverImmediately?: boolean,
 *     respectNotificationPreferences?: boolean, // Si true, solo envía a usuarios con browser notifications habilitadas
 *     testMode?: boolean, // Si true, no crea alertas reales
 *     limit?: number // Limitar número de usuarios
 *   },
 *   campaign?: {
 *     name: string,
 *     type: string,
 *     trackingId: string
 *   }
 * }
 */
const createBulkAlerts = async (req, res) => {
  try {
    const { 
      filter = {}, 
      template, 
      options = {}, 
      campaign 
    } = req.body;

    // Validaciones
    if (!template || !template.secondaryText || !template.actionText) {
      return res.status(400).json({
        success: false,
        error: 'La plantilla debe incluir secondaryText y actionText'
      });
    }

    // Construir query de usuarios
    const userQuery = { ...filter };
    
    // Si respectNotificationPreferences es true, filtrar usuarios con notificaciones habilitadas
    if (options.respectNotificationPreferences) {
      userQuery['preferences.notifications.channels.browser'] = true;
    }

    // Buscar usuarios que cumplan los criterios
    let usersQuery = User.find(userQuery).select('_id email name preferences');
    
    if (options.limit) {
      usersQuery = usersQuery.limit(parseInt(options.limit));
    }

    const users = await usersQuery;

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No se encontraron usuarios que cumplan los criterios'
      });
    }

    logger.info(`Preparando alertas masivas para ${users.length} usuarios`);

    // Si es modo de prueba, solo devolver preview
    if (options.testMode) {
      const preview = users.slice(0, 5).map(user => ({
        userId: user._id,
        email: user.email,
        name: user.name,
        alertPreview: {
          ...template,
          secondaryText: template.secondaryText
            .replace(/{{name}}/g, user.name || 'Usuario')
            .replace(/{{email}}/g, user.email),
          userId: user._id
        }
      }));

      return res.json({
        success: true,
        testMode: true,
        totalUsers: users.length,
        preview: preview
      });
    }

    // Crear alertas reales
    const results = {
      created: [],
      delivered: [],
      failed: []
    };

    // Procesar en lotes para mejor rendimiento
    const batchSize = 100;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (user) => {
        try {
          // Personalizar plantilla con datos del usuario
          const personalizedAlert = {
            ...template,
            secondaryText: template.secondaryText
              .replace(/{{name}}/g, user.name || 'Usuario')
              .replace(/{{email}}/g, user.email),
            folderId: template.folderId, // Ahora es opcional
            sourceType: template.sourceType || (campaign ? 'marketing' : 'system'),
            delivered: false,
            read: false,
            deliveryAttempts: 0
          };

          // Crear alerta
          const newAlert = await Alert.create({
            userId: user._id,
            ...personalizedAlert
          });

          results.created.push({
            userId: user._id,
            alertId: newAlert._id
          });

          // Registrar en NotificationLog
          await NotificationLog.create({
            userId: user._id,
            entityType: 'alert',
            entityId: newAlert._id,
            entitySnapshot: {
              secondaryText: newAlert.secondaryText,
              actionText: newAlert.actionText,
              expirationDate: newAlert.expirationDate
            },
            sentAt: new Date(),
            scheduledFor: new Date(),
            notification: {
              method: 'browser',
              status: 'created',
              content: {
                subject: newAlert.primaryText || 'Alerta masiva',
                message: newAlert.secondaryText,
                template: 'bulk_alert'
              }
            },
            config: {
              source: 'bulk_alert',
              campaign: campaign
            },
            metadata: {
              batchId: req.headers['x-request-id'] || new mongoose.Types.ObjectId().toString(),
              campaign
            }
          });

          // Entregar si está configurado y el usuario está conectado
          if (options.deliverImmediately && websocketService.isUserConnected(user._id)) {
            try {
              await websocketService.sendPushAlert(user._id, newAlert);
              await Alert.findByIdAndUpdate(newAlert._id, {
                delivered: true,
                deliveryAttempts: 1,
                lastDeliveryAttempt: new Date()
              });
              results.delivered.push({
                userId: user._id,
                alertId: newAlert._id
              });
            } catch (wsError) {
              logger.error(`Error entregando alerta masiva: ${wsError.message}`);
            }
          }

        } catch (error) {
          logger.error(`Error creando alerta masiva para usuario ${user._id}: ${error.message}`);
          results.failed.push({
            userId: user._id,
            error: error.message
          });
        }
      }));
    }

    const summary = {
      success: true,
      summary: {
        total: users.length,
        created: results.created.length,
        delivered: results.delivered.length,
        pending: results.created.length - results.delivered.length,
        failed: results.failed.length
      },
      campaign: campaign,
      batchId: req.headers['x-request-id'] || 'N/A'
    };

    logger.info(`Alertas masivas completadas: ${JSON.stringify(summary.summary)}`);

    res.json(summary);

  } catch (error) {
    logger.error('Error al crear alertas masivas:', error);
    res.status(500).json({
      success: false,
      error: 'Error al crear alertas masivas',
      message: error.message
    });
  }
};

/**
 * Obtener alertas pendientes de un usuario
 * 
 * @route GET /api/alerts/pending/:userId
 */
const getPendingAlerts = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, includeExpired = false } = req.query;

    const query = {
      userId: userId,
      delivered: false
    };

    // Filtrar alertas expiradas si no se solicitan explícitamente
    if (!includeExpired) {
      query.$or = [
        { expirationDate: { $exists: false } },
        { expirationDate: null },
        { expirationDate: { $gt: new Date() } }
      ];
    }

    const alerts = await Alert.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      count: alerts.length,
      alerts: alerts
    });

  } catch (error) {
    logger.error('Error al obtener alertas pendientes:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener alertas pendientes'
    });
  }
};

/**
 * Marcar alerta como leída
 * 
 * @route PUT /api/alerts/:alertId/read
 */
const markAlertAsRead = async (req, res) => {
  try {
    const { alertId } = req.params;

    const alert = await Alert.findByIdAndUpdate(
      alertId,
      { 
        read: true,
        readAt: new Date()
      },
      { new: true }
    );

    if (!alert) {
      return res.status(404).json({
        success: false,
        error: 'Alerta no encontrada'
      });
    }

    // Actualizar NotificationLog
    await NotificationLog.updateOne(
      { entityId: alertId },
      { 
        'notification.status': 'read',
        'metadata.readAt': new Date()
      }
    );

    res.json({
      success: true,
      alert: alert
    });

  } catch (error) {
    logger.error('Error al marcar alerta como leída:', error);
    res.status(500).json({
      success: false,
      error: 'Error al marcar alerta como leída'
    });
  }
};

/**
 * Eliminar alertas antiguas o expiradas
 * 
 * @route DELETE /api/alerts/cleanup
 */
const cleanupAlerts = async (req, res) => {
  try {
    const { 
      daysOld = 30, 
      onlyDelivered = true,
      dryRun = true 
    } = req.body;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(daysOld));

    const query = {
      createdAt: { $lt: cutoffDate }
    };

    if (onlyDelivered) {
      query.delivered = true;
    }

    // Agregar condición para alertas expiradas
    query.$or = [
      { createdAt: { $lt: cutoffDate } },
      { 
        expirationDate: { 
          $exists: true, 
          $ne: null,
          $lt: new Date() 
        } 
      }
    ];

    if (dryRun) {
      const count = await Alert.countDocuments(query);
      return res.json({
        success: true,
        dryRun: true,
        alertsToDelete: count,
        criteria: {
          daysOld,
          onlyDelivered,
          cutoffDate
        }
      });
    }

    // Eliminar alertas
    const result = await Alert.deleteMany(query);

    logger.info(`Limpieza de alertas completada: ${result.deletedCount} alertas eliminadas`);

    res.json({
      success: true,
      deleted: result.deletedCount,
      criteria: {
        daysOld,
        onlyDelivered,
        cutoffDate
      }
    });

  } catch (error) {
    logger.error('Error al limpiar alertas:', error);
    res.status(500).json({
      success: false,
      error: 'Error al limpiar alertas'
    });
  }
};

module.exports = {
  createCustomAlert,
  createBulkAlerts,
  getPendingAlerts,
  markAlertAsRead,
  cleanupAlerts
};