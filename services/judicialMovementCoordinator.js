/**
 * Servicio de Coordinación de Movimientos Judiciales
 *
 * Este servicio busca causas con movimientos del día actual y crea los documentos
 * JudicialMovement faltantes para que puedan ser notificados.
 */

const mongoose = require('mongoose');
const moment = require('moment-timezone');
const logger = require('../config/logger');

// Configuración
const TIMEZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_NOTIFICATION_HOUR = 19; // 19:00 horas

/**
 * Mapeo de nombres de colección para cada tipo de causa
 */
const CAUSA_COLLECTIONS = {
  'CausasCivil': 'causas-civil',
  'CausasComercial': 'causas-comercial',
  'CausasSegSoc': 'causas-segsocial',
  'CausasTrabajo': 'causas-trabajo',
  'CausasCAF': 'causas_caf',
  'CausasCCF': 'causas_ccf',
  'CausasCNE': 'causas_cne',
  'CausasCPE': 'causas_cpe',
  'CausasCFP': 'causas_cfp',
  'CausasCCC': 'causas_ccc',
  'CausasCSJ': 'causas_csj'
};

/**
 * Busca causas con movimientos en la fecha especificada
 * Las fechas en las causas están almacenadas en UTC medianoche (00:00:00.000Z)
 */
async function findCausasWithMovements(targetDate) {
  const targetDateUTC = moment.utc(targetDate).startOf('day').toDate();
  const nextDayUTC = moment.utc(targetDate).add(1, 'day').startOf('day').toDate();

  const allCausas = [];
  const db = mongoose.connection.db;

  for (const [modelName, collectionName] of Object.entries(CAUSA_COLLECTIONS)) {
    try {
      const collection = db.collection(collectionName);
      const causas = await collection.find({
        fechaUltimoMovimiento: {
          $gte: targetDateUTC,
          $lt: nextDayUTC
        }
      }).toArray();

      if (causas.length > 0) {
        causas.forEach(causa => {
          causa._modelName = modelName;
          causa._collectionName = collectionName;
        });
        allCausas.push(...causas);
      }
    } catch (error) {
      logger.error(`[Coordinator] Error en ${modelName}: ${error.message}`);
    }
  }

  return allCausas;
}

/**
 * Filtra los movimientos de una causa que coincidan con la fecha objetivo
 * Las fechas de movimientos están en UTC
 */
function filterMovementsByDate(causa, targetDate) {
  if (!causa.movimiento || !Array.isArray(causa.movimiento)) {
    return [];
  }

  const targetDateStr = moment.utc(targetDate).format('YYYY-MM-DD');

  return causa.movimiento.filter(mov => {
    if (!mov.fecha) return false;
    const movDateStr = moment.utc(mov.fecha).format('YYYY-MM-DD');
    return movDateStr === targetDateStr;
  });
}

/**
 * Obtiene los usuarios vinculados a una causa a través de los Folders
 */
async function getUsersForCausa(Folder, causaId) {
  const folders = await Folder.find({ causaId }).select('userId').lean();
  const userIds = [...new Set(folders.map(f => f.userId?.toString()).filter(Boolean))];
  return userIds;
}

/**
 * Calcula la hora de notificación para las 19:00 Argentina
 * Si ya pasó las 19:00, usa la hora actual
 */
function calculateNotifyAt() {
  const notifyAt = moment.tz(TIMEZONE)
    .hour(DEFAULT_NOTIFICATION_HOUR)
    .minute(0)
    .second(0)
    .millisecond(0)
    .toDate();

  const now = new Date();
  return notifyAt < now ? now : notifyAt;
}

/**
 * Función principal de coordinación
 * Crea documentos JudicialMovement faltantes para movimientos del día
 *
 * @param {Object} options - Opciones de configuración
 * @param {Object} options.models - Modelos de mongoose { Folder, JudicialMovement }
 * @param {Date} options.targetDate - Fecha objetivo (opcional, default: hoy)
 * @returns {Object} Estadísticas de la coordinación
 */
async function coordinateJudicialMovements(options = {}) {
  const { models, targetDate: customDate } = options;
  const { Folder, JudicialMovement } = models;

  const targetDate = customDate || moment.tz(TIMEZONE);
  const targetDateStr = moment(targetDate).format('YYYY-MM-DD');

  logger.info(`[Coordinator] Iniciando coordinación para fecha: ${targetDateStr}`);

  const stats = {
    causasEncontradas: 0,
    movimientosDelDia: 0,
    usuariosVinculados: 0,
    notificacionesExistentes: 0,
    notificacionesCreadas: 0,
    errores: 0
  };

  try {
    // Buscar causas con movimientos del día
    const causas = await findCausasWithMovements(targetDate);
    stats.causasEncontradas = causas.length;

    if (causas.length === 0) {
      logger.info(`[Coordinator] No se encontraron causas con movimientos para ${targetDateStr}`);
      return stats;
    }

    logger.info(`[Coordinator] Encontradas ${causas.length} causas con movimientos`);

    // Calcular hora de notificación (19:00 Argentina o ahora si ya pasó)
    const notifyAt = calculateNotifyAt();

    // Procesar cada causa
    for (const causa of causas) {
      // Filtrar movimientos del día
      const movimientosDelDia = filterMovementsByDate(causa, targetDate);

      if (movimientosDelDia.length === 0) {
        continue;
      }

      stats.movimientosDelDia += movimientosDelDia.length;

      // Obtener usuarios vinculados
      const userIds = await getUsersForCausa(Folder, causa._id);

      if (userIds.length === 0) {
        continue;
      }

      stats.usuariosVinculados += userIds.length;

      // Procesar cada combinación de usuario y movimiento
      for (const userId of userIds) {
        for (const movimiento of movimientosDelDia) {
          try {
            // Generar uniqueKey
            const uniqueKey = JudicialMovement.generateUniqueKey(
              userId,
              causa._id.toString(),
              movimiento.fecha,
              movimiento.tipo,
              movimiento.detalle
            );

            // Verificar si ya existe
            const existing = await JudicialMovement.findOne({ uniqueKey });

            if (existing) {
              stats.notificacionesExistentes++;
              continue;
            }

            // Crear documento de notificación
            await JudicialMovement.create({
              userId: new mongoose.Types.ObjectId(userId),
              expediente: {
                id: causa._id.toString(),
                number: causa.number,
                year: causa.year,
                fuero: causa.fuero,
                caratula: causa.caratula,
                objeto: causa.objeto
              },
              movimiento: {
                fecha: new Date(movimiento.fecha),
                tipo: movimiento.tipo,
                detalle: movimiento.detalle,
                url: movimiento.url
              },
              notificationSettings: {
                notifyAt: notifyAt,
                channels: ['email', 'browser']
              },
              uniqueKey,
              notificationStatus: 'pending'
            });

            stats.notificacionesCreadas++;

          } catch (error) {
            if (error.code === 11000) {
              // Duplicado - ya existe
              stats.notificacionesExistentes++;
            } else {
              stats.errores++;
              logger.error(`[Coordinator] Error creando notificación: ${error.message}`);
            }
          }
        }
      }
    }

    logger.info(`[Coordinator] Coordinación completada: ${JSON.stringify(stats)}`);
    return stats;

  } catch (error) {
    logger.error(`[Coordinator] Error fatal: ${error.message}`);
    stats.errores++;
    return stats;
  }
}

module.exports = {
  coordinateJudicialMovements,
  findCausasWithMovements,
  filterMovementsByDate,
  getUsersForCausa,
  calculateNotifyAt,
  CAUSA_COLLECTIONS,
  TIMEZONE,
  DEFAULT_NOTIFICATION_HOUR
};
