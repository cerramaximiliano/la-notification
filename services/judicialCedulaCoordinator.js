/**
 * Coordinación de cédulas (notificaciones electrónicas).
 *
 * Espejo de judicialMovementCoordinator pero para las cédulas que levanta el
 * worker pjn-bandeja-sync en la colección `pjn-notifications`. Lee los docs no
 * coordinados (notified=false), crea los JudicialCedula pending faltantes y
 * marca el doc origen como notified para no reprocesarlo.
 *
 * Destinatario = dueño de la credencial (pjn-notifications.userId). La cédula es
 * a su domicilio electrónico, por eso no se expande a otros usuarios del folder.
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');
const { calculateNotifyAt } = require('./judicialMovementCoordinator');

const SOURCE_COLLECTION = 'pjn-notifications';
const BATCH_LIMIT = 500;

function deriveFuero(expediente) {
  const numeracion = expediente && expediente.numeracion;
  if (numeracion && typeof numeracion === 'string') {
    const token = numeracion.trim().split(/\s+/)[0];
    if (token) return token;
  }
  return (expediente && expediente.camara) || 'PJN';
}

/**
 * @param {Object} options
 * @param {Object} options.models - { JudicialCedula }
 * @returns {Object} stats
 */
async function coordinateJudicialCedulas(options = {}) {
  const { models } = options;
  const { JudicialCedula } = models;

  const stats = {
    notificacionesOrigen: 0,
    cedulasCreadas: 0,
    cedulasExistentes: 0,
    sinUsuario: 0,
    errores: 0
  };

  try {
    const db = mongoose.connection.db;
    const sourceColl = db.collection(SOURCE_COLLECTION);

    const pendientes = await sourceColl
      .find({ notified: { $ne: true } })
      .limit(BATCH_LIMIT)
      .toArray();

    stats.notificacionesOrigen = pendientes.length;
    if (pendientes.length === 0) {
      return stats;
    }

    logger.info(`[CoordinatorCedulas] ${pendientes.length} notificaciones sin coordinar`);
    const notifyAt = calculateNotifyAt();

    for (const doc of pendientes) {
      try {
        if (!doc.userId) {
          stats.sinUsuario++;
          // Marcar para no reprocesar eternamente un doc sin usuario.
          await sourceColl.updateOne({ _id: doc._id }, { $set: { notified: true, notifiedAt: new Date() } });
          continue;
        }

        const expediente = doc.expediente || {};
        const expedienteId = expediente.id != null ? String(expediente.id) : null;
        if (!expedienteId) {
          stats.errores++;
          await sourceColl.updateOne({ _id: doc._id }, { $set: { notified: true, notifiedAt: new Date() } });
          continue;
        }

        const uniqueKey = JudicialCedula.generateUniqueKey(doc.userId.toString(), doc.sourceId);
        const existing = await JudicialCedula.findOne({ uniqueKey });

        if (existing) {
          stats.cedulasExistentes++;
        } else {
          await JudicialCedula.create({
            userId: new mongoose.Types.ObjectId(doc.userId),
            expediente: {
              id: expedienteId,
              number: expediente.numero,
              year: expediente.anio,
              fuero: deriveFuero(expediente),
              caratula: expediente.caratula || '(sin carátula)'
            },
            cedula: {
              sourceId: doc.sourceId,
              numeroCedula: doc.numeroCedula,
              fecha: doc.fecha ? new Date(doc.fecha) : new Date(doc.createdAt || Date.now()),
              tipo: 'Cédula',
              oficina: (doc.oficina && doc.oficina.descripcion) || expediente.oficina || null,
              nombreAutor: doc.nombreAutor || null
            },
            notificationSettings: {
              notifyAt,
              channels: ['email', 'browser']
            },
            uniqueKey,
            notificationStatus: 'pending'
          });
          stats.cedulasCreadas++;
        }

        // Marcar el doc origen como coordinado.
        await sourceColl.updateOne(
          { _id: doc._id },
          { $set: { notified: true, notifiedAt: new Date() } }
        );

      } catch (error) {
        if (error.code === 11000) {
          stats.cedulasExistentes++;
          await sourceColl.updateOne({ _id: doc._id }, { $set: { notified: true, notifiedAt: new Date() } });
        } else {
          stats.errores++;
          logger.error(`[CoordinatorCedulas] Error creando cédula: ${error.message}`);
        }
      }
    }

    logger.info(`[CoordinatorCedulas] Coordinación completada: ${JSON.stringify(stats)}`);
    return stats;

  } catch (error) {
    logger.error(`[CoordinatorCedulas] Error fatal: ${error.message}`);
    stats.errores++;
    return stats;
  }
}

module.exports = { coordinateJudicialCedulas };
