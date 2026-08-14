/**
 * Safe guard diario de notificaciones postales.
 *
 * Doble red, porque los avisos postales salen por webhook inmediato y ese
 * camino puede fallar de dos formas distintas:
 *
 *   1. El webhook llegó pero el email falló → hay PostalNotification en
 *      'pending'/'failed' → se reintenta.
 *   2. El webhook NUNCA llegó (worker caído, red cortada, deploy) → no hay
 *      documento nuestro, pero el worker dejó los eventos con
 *      `notifiedAt: null` en `postal-trackings` → se barre esa colección
 *      (mismo patrón que el coordinador de cédulas con `pjn-notifications`).
 *
 * Al enviar con éxito se marca `notifiedAt` en el documento de origen para
 * cerrar el ciclo y que el worker no lo reintente.
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');

const SOURCE_COLLECTION = 'postal-trackings';
const BATCH_LIMIT = 200;

/**
 * @param {Object} options
 * @param {Object} options.models - { PostalNotification }
 * @returns {Object} stats
 */
async function runPostalSafeGuard(options = {}) {
  const { models } = options;
  const { PostalNotification } = models;
  const { sendPostalNotification } = require('./notifications');

  const stats = {
    reintentosPendientes: 0,
    reintentosOk: 0,
    trackingsEscaneados: 0,
    eventosHuerfanos: 0,
    notificacionesCreadas: 0,
    enviadas: 0,
    errores: 0,
    skippedByConfig: null
  };

  try {
    const policyService = require('./notificationPolicyService');
    const config = await policyService.getConfigCached();

    if (!policyService.isGloballyEnabled(config)) {
      stats.skippedByConfig = 'notificaciones deshabilitadas globalmente';
      return stats;
    }
    const postalCfg = (config && config.postalNotifications) || {};
    if (postalCfg.enabled === false) {
      stats.skippedByConfig = 'notificaciones postales deshabilitadas';
      return stats;
    }
    if (postalCfg.safeGuardEnabled === false) {
      stats.skippedByConfig = 'safe guard postal deshabilitado';
      return stats;
    }

    // ---- (1) Reintento de lo que quedó pendiente/fallido ----
    const pendientes = await PostalNotification.find({
      notificationStatus: { $in: ['pending', 'failed'] }
    }).limit(BATCH_LIMIT);

    stats.reintentosPendientes = pendientes.length;

    for (const notif of pendientes) {
      try {
        const result = await sendPostalNotification({ notification: notif });
        if (result.sent) {
          stats.reintentosOk++;
          stats.enviadas++;
          await marcarOrigenNotificado(notif);
        }
      } catch (err) {
        stats.errores++;
        logger.error(`[PostalSafeGuard] Error reintentando ${notif._id}: ${err.message}`);
      }
    }

    // ---- (2) Barrido de eventos huérfanos en postal-trackings ----
    const db = mongoose.connection.db;
    const sourceColl = db.collection(SOURCE_COLLECTION);

    const candidatos = await sourceColl
      .find({
        userId: { $ne: null },
        history: { $elemMatch: { notifiedAt: null } }
      })
      .limit(BATCH_LIMIT)
      .toArray();

    stats.trackingsEscaneados = candidatos.length;

    for (const doc of candidatos) {
      try {
        const pendientesEv = (doc.history || []).filter(ev => !ev.notifiedAt);
        if (pendientesEv.length === 0) continue;
        stats.eventosHuerfanos += pendientesEv.length;

        const events = pendientesEv.map(ev => ({
          sourceEventId: ev._id ? String(ev._id) : undefined,
          status: ev.status,
          deliveryStatus: ev.deliveryStatus,
          description: ev.description,
          location: ev.location,
          eventDate: ev.eventDate
        }));

        const uniqueKey = PostalNotification.generateUniqueKey(String(doc.userId), String(doc._id), events);
        const yaExiste = await PostalNotification.findOne({ uniqueKey });

        if (yaExiste && yaExiste.notificationStatus === 'sent') {
          // Ya se notificó por webhook pero el worker no llegó a marcarlo.
          await marcarOrigenNotificado(yaExiste, doc, pendientesEv);
          continue;
        }

        let folderName = null;
        if (doc.folderId) {
          try {
            const folder = await db.collection('folders').findOne({ _id: doc.folderId }, { projection: { folderName: 1 } });
            folderName = folder ? folder.folderName : null;
          } catch (_) { /* decorativo */ }
        }

        const notif = yaExiste || await PostalNotification.create({
          userId: new mongoose.Types.ObjectId(String(doc.userId)),
          tracking: {
            trackingId: String(doc._id),
            codeId: doc.codeId,
            numberId: doc.numberId,
            folderId: doc.folderId ? String(doc.folderId) : undefined,
            folderName,
            isFinalStatus: doc.isFinalStatus === true
          },
          events,
          source: 'safeguard',
          uniqueKey,
          notificationStatus: 'pending'
        });

        if (!yaExiste) stats.notificacionesCreadas++;

        const result = await sendPostalNotification({ notification: notif });
        if (result.sent) {
          stats.enviadas++;
          await marcarOrigenNotificado(notif, doc, pendientesEv);
        } else if (notif.notificationStatus === 'skipped') {
          // Preferencia del usuario / config: cerrar el ciclo igual para no
          // reprocesar estos eventos en cada corrida.
          await marcarOrigenNotificado(notif, doc, pendientesEv);
        }
      } catch (err) {
        stats.errores++;
        logger.error(`[PostalSafeGuard] Error procesando tracking ${doc._id}: ${err.message}`);
      }
    }

    logger.info(`[PostalSafeGuard] Completado: ${JSON.stringify(stats)}`);
    return stats;

  } catch (error) {
    stats.errores++;
    logger.error(`[PostalSafeGuard] Error fatal: ${error.message}`);
    return stats;
  }
}

/**
 * Marca `notifiedAt` en los eventos del documento de postal-trackings.
 * Si no se pasa el doc/eventos, se resuelven desde la notificación.
 */
async function marcarOrigenNotificado(notif, doc = null, eventos = null) {
  try {
    const db = mongoose.connection.db;
    const sourceColl = db.collection(SOURCE_COLLECTION);
    const trackingId = notif.tracking?.trackingId;
    if (!trackingId) return;

    const ids = (eventos || [])
      .map(ev => ev._id)
      .filter(Boolean);

    const now = new Date();

    if (ids.length > 0) {
      await sourceColl.updateOne(
        { _id: new mongoose.Types.ObjectId(trackingId) },
        { $set: { 'history.$[ev].notifiedAt': now } },
        { arrayFilters: [{ 'ev._id': { $in: ids } }] }
      );
    } else {
      // Sin ids explícitos: marcar todos los pendientes del doc.
      await sourceColl.updateOne(
        { _id: new mongoose.Types.ObjectId(trackingId) },
        { $set: { 'history.$[ev].notifiedAt': now } },
        { arrayFilters: [{ 'ev.notifiedAt': null }] }
      );
    }
  } catch (err) {
    logger.warn(`[PostalSafeGuard] No se pudo marcar notifiedAt en el origen: ${err.message}`);
  }
}

module.exports = { runPostalSafeGuard };
