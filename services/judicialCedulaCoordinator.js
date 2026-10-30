/**
 * Coordinación de cédulas (notificaciones electrónicas).
 *
 * Espejo de judicialMovementCoordinator pero para las cédulas que levanta el
 * worker pjn-bandeja-sync en la colección `pjn-notifications`. Lee los docs no
 * coordinados (notified=false), crea los JudicialCedula pending faltantes y
 * marca el doc origen como notified para no reprocesarlo.
 *
 * Destinatarios = dueño de la credencial (pjn-notifications.userId) más, si
 * ese usuario es owner o miembro activo de un equipo activo (colección
 * `groups`), el resto del equipo (decisión del dueño, 29/10). Se crea un
 * JudicialCedula por destinatario (el uniqueKey ya incluye el userId); el doc
 * origen se marca notified una sola vez. Sin equipo, solo el dueño, como antes.
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');
const { calculateNotifyAt } = require('./judicialMovementCoordinator');
const policyService = require('./notificationPolicyService');
const { resolveTeamContextForUser, applyFolderPolicy } = require('./teamRecipients');

const SOURCE_COLLECTION = 'pjn-notifications';
const BATCH_LIMIT = 500;

// Día calendario en Argentina (UTC-3 fijo; Argentina no usa DST).
function argentinaDayStr(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function isTodayART(date) {
  const day = argentinaDayStr(date);
  return day != null && day === argentinaDayStr(new Date());
}

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
    cedulasEquipo: 0,
    cedulasExistentes: 0,
    omitidasNoHoy: 0,
    sinUsuario: 0,
    errores: 0,
    skippedByConfig: null
  };

  try {
    // Gates centrales: kill-switch global + toggle específico de cédulas.
    // No se aplican activeDays: la cédula es una notificación electrónica al
    // domicilio del usuario, con relevancia legal — no se descarta por calendario.
    const config = await policyService.getConfigCached();
    if (!policyService.isGloballyEnabled(config)) {
      stats.skippedByConfig = 'notificaciones deshabilitadas globalmente (status.enabled/mode)';
      logger.info(`[CoordinatorCedulas] Omitido: ${stats.skippedByConfig}`);
      return stats;
    }
    if (config && config.status && config.status.cedulasEnabled === false) {
      stats.skippedByConfig = 'cédulas deshabilitadas (status.cedulasEnabled)';
      logger.info(`[CoordinatorCedulas] Omitido: ${stats.skippedByConfig}`);
      return stats;
    }

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
    const notifyAt = config ? policyService.getScheduledNotifyAt(config, 19) : calculateNotifyAt();
    // Cache de equipos por usuario para esta pasada.
    const teamCache = new Map();

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

        // Solo notificar cédulas del día actual. Las viejas (lookback/catch-up,
        // ya recibidas por el usuario) se marcan como coordinadas SIN enviar email.
        const fechaCedula = doc.fecha || doc.createdAt;
        if (!isTodayART(fechaCedula)) {
          stats.omitidasNoHoy++;
          await sourceColl.updateOne({ _id: doc._id }, { $set: { notified: true, notifiedAt: new Date() } });
          continue;
        }

        // Destinatarios: el dueño de la credencial y, si tiene equipo, el resto
        // de los miembros activos. Una JudicialCedula por destinatario.
        const ownerId = doc.userId.toString();
        // Reglas de avisos del equipo (30/10/2026): si la causa está en una carpeta del
        // equipo, rigen sus responsables y su regla; sin carpeta, todo el equipo.
        let recipients = [ownerId];
        const ctx = await resolveTeamContextForUser(ownerId, teamCache);
        if (ctx) {
          let folder = null;
          try {
            folder = await mongoose.connection.db.collection('folders').findOne(
              { causaId: { $in: [expedienteId, ...(mongoose.Types.ObjectId.isValid(expedienteId) ? [new mongoose.Types.ObjectId(expedienteId)] : [])] },
                $or: [{ groupId: new mongoose.Types.ObjectId(ctx.groupId) }, { userId: new mongoose.Types.ObjectId(ctx.owner) }] },
              { projection: { responsables: 1, notificationPolicy: 1, createdBy: 1 } }
            );
          } catch (e) {
            logger.warn(`[CoordinatorCedulas] no se pudo leer la carpeta de ${expedienteId}: ${e.message}`);
          }
          recipients = folder ? applyFolderPolicy(ctx, folder) : ctx.recipients;
          if (!recipients.includes(ownerId) && !folder) recipients.unshift(ownerId);
        }

        for (const recipientId of recipients) {
          const uniqueKey = JudicialCedula.generateUniqueKey(recipientId, doc.sourceId);
          const existing = await JudicialCedula.findOne({ uniqueKey });

          if (existing) {
            stats.cedulasExistentes++;
            continue;
          }

          try {
            await JudicialCedula.create({
              userId: new mongoose.Types.ObjectId(recipientId),
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
            if (recipientId !== ownerId) stats.cedulasEquipo++;
          } catch (error) {
            // Duplicado por carrera: ya existe para este destinatario, seguir con el resto.
            if (error.code === 11000) {
              stats.cedulasExistentes++;
            } else {
              throw error;
            }
          }
        }

        // Marcar el doc origen como coordinado (una sola vez, con todos los destinatarios creados).
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
