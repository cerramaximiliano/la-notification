// services/channels/push — notificaciones push a la app mobile (FCM).
//
// Los tokens de dispositivo los registra el hub (POST /api/mobile/devices,
// modelo law-analytics-server/models/DeviceToken.js) en la collection
// `device-tokens` de la misma DB. Acá sólo se leen y se limpian los que FCM
// reporta como muertos.
//
// Credencial: FIREBASE_SERVICE_ACCOUNT (JSON inline o ruta a archivo) del
// proyecto Firebase de Law Analytics. Sin credencial el canal es no-op, así que
// dev/test y el despliegue previo a configurar Firebase no cambian de conducta.
//
// El socket (websocket.js) sigue siendo el canal en primer plano; el push es lo
// que llega con la app cerrada o en segundo plano. No se toca `Alert.delivered`
// (es el flag del socket: el front web sigue recibiendo `pending_alerts`).
const fs = require('fs');
const mongoose = require('mongoose');
const logger = require('../../../config/logger');

const DEVICE_TOKENS = 'device-tokens';
const INVALID_TOKEN_CODES = ['registration-token-not-registered', 'invalid-registration-token', 'invalid-argument'];

let messaging = null;
let initialized = false;

// FIREBASE_SERVICE_ACCOUNT acepta: JSON inline, base64 del JSON (recomendado en
// Secrets Manager: una sola línea, sin escapes que rompan el .env que genera
// config/env.js) o ruta a un archivo.
function parseServiceAccount(raw) {
  const value = raw.trim();
  if (value.startsWith('{')) return JSON.parse(value);
  if (fs.existsSync(value)) return JSON.parse(fs.readFileSync(value, 'utf-8'));
  const decoded = Buffer.from(value, 'base64').toString('utf-8').trim();
  if (decoded.startsWith('{')) return JSON.parse(decoded);
  throw new Error('FIREBASE_SERVICE_ACCOUNT no es JSON, base64 de JSON ni una ruta existente');
}

function init() {
  if (initialized) return messaging;
  initialized = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    logger.info('Push: sin FIREBASE_SERVICE_ACCOUNT — notificaciones push deshabilitadas');
    return null;
  }
  try {
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    const serviceAccount = parseServiceAccount(raw);
    const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
    messaging = getMessaging(app);
    logger.info('Push: Firebase inicializado');
  } catch (error) {
    logger.error(`Push: no se pudo inicializar Firebase: ${error.message}`);
    messaging = null;
  }
  return messaging;
}

function isEnabled() {
  return !!init();
}

// Ruta de la app a la que lleva el tap (las rutas de la app espejan las web).
function routeForAlert(alert) {
  const folderId = alert.folderId ? String(alert.folderId) : null;
  switch (alert.sourceType) {
    case 'movement':
      return folderId ? `/apps/folders/details/${folderId}` : '/alerts';
    case 'event':
      return '/apps/calendar';
    case 'task':
      return '/tareas';
    default:
      return '/alerts';
  }
}

// Canal Android según el tipo de alerta (los crea la app al arrancar).
function channelForAlert(alert) {
  if (alert.sourceType === 'movement') return 'movimientos';
  if (alert.sourceType === 'event' || alert.sourceType === 'task') return 'vencimientos';
  return 'sistema';
}

async function userAcceptsMobile(userId) {
  try {
    const User = mongoose.model('User');
    const user = await User.findById(userId).select('preferences.notifications').lean();
    const notifications = user?.preferences?.notifications;
    if (!notifications) return true;
    if (notifications.enabled === false) return false;
    return notifications.channels?.mobile !== false;
  } catch (error) {
    logger.warn(`Push: no se pudieron leer preferencias de ${userId}: ${error.message}`);
    return true;
  }
}

function collection() {
  const db = mongoose.connection.db;
  return db ? db.collection(DEVICE_TOKENS) : null;
}

/**
 * Envía una push a todos los dispositivos de un usuario.
 * @param {string} userId
 * @param {{title: string, body: string, route?: string, channelId?: string, data?: object}} message
 * @returns {Promise<{sent: number, removed: number}>}
 */
async function pushToUser(userId, { title, body, route, channelId = 'sistema', data = {} }) {
  const fcm = init();
  const col = collection();
  if (!fcm || !col || !userId) return { sent: 0, removed: 0 };

  const devices = await col.find({ user: new mongoose.Types.ObjectId(String(userId)) }).project({ fcmToken: 1 }).toArray();
  if (devices.length === 0) return { sent: 0, removed: 0 };

  // FCM exige strings en `data`.
  const payloadData = Object.fromEntries(
    Object.entries({ ...data, route: route || '/alerts' }).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])
  );

  const invalid = [];
  let sent = 0;
  await Promise.all(
    devices.map(async (device) => {
      try {
        await fcm.send({
          token: device.fcmToken,
          notification: { title, body },
          data: payloadData,
          android: { priority: 'high', notification: { channelId, sound: 'default' } }
        });
        sent++;
      } catch (error) {
        const code = error?.errorInfo?.code || error?.code || '';
        if (INVALID_TOKEN_CODES.some((c) => code.includes(c))) invalid.push(device.fcmToken);
        else logger.warn(`Push: fallo enviando a un dispositivo de ${userId}: ${code || error.message}`);
      }
    })
  );

  if (invalid.length > 0) await col.deleteMany({ fcmToken: { $in: invalid } });
  return { sent, removed: invalid.length };
}

/**
 * Push de una Alert recién creada. Respeta preferences.notifications.channels.mobile
 * y no manda alertas de marketing. Nunca lanza: el push es best-effort.
 */
async function pushAlert(userId, alert) {
  try {
    if (!alert || !isEnabled()) return { sent: 0, removed: 0 };
    if (alert.sourceType === 'marketing') return { sent: 0, removed: 0 };
    if (!(await userAcceptsMobile(userId))) return { sent: 0, removed: 0 };

    const title = alert.primaryText || 'Law Analytics';
    const body = alert.secondaryText || alert.actionText || '';
    const result = await pushToUser(userId, {
      title,
      body,
      route: routeForAlert(alert),
      channelId: channelForAlert(alert),
      data: {
        type: alert.sourceType || 'custom',
        alertId: alert._id,
        folderId: alert.folderId,
        sourceId: alert.sourceId
      }
    });
    if (result.sent > 0) logger.info(`Push enviada a ${result.sent} dispositivo(s) del usuario ${userId}`);
    return result;
  } catch (error) {
    logger.error(`Push: error enviando alerta a ${userId}: ${error.message}`);
    return { sent: 0, removed: 0 };
  }
}

module.exports = {
  isEnabled,
  pushToUser,
  pushAlert,
  // exportados para tests
  routeForAlert,
  channelForAlert
};
