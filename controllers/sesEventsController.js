/**
 * Receptor de eventos de SES vía SNS.
 *
 * Hoy los NotificationLog quedan en estado "sent" para siempre: eso solo
 * significa que SES aceptó el envío, no que el correo haya llegado. Este
 * endpoint recibe los eventos que SES publica (entrega, rebote, queja,
 * demora) y actualiza el registro correspondiente, correlacionando por el
 * `delivery.sesMessageId` que se guarda desde el commit 7c4eaed.
 *
 * Modelado sobre la-marketing-service/controllers/snsWebhookController.js,
 * que hace lo mismo para las campañas de marketing.
 *
 * Infraestructura (hecha, us-east-1): tema SNS `ses-notification-events`,
 * configuration set `notificaciones-judiciales` (Delivery/Bounce/Complaint/
 * DeliveryDelay + Open/Click desde 2026-08-21) que `services/email.js` pasa en
 * cada SendEmailCommand, y suscripción https de este endpoint al tema.
 *
 * Además del NotificationLog, desde 2026-10-24 actualiza el registro de
 * `emaillogs` (auditoría central del ecosistema) que `services/email.js`
 * escribe por cada envío: hasta entonces los 1.140 correos de 60 días de este
 * servicio figuraban `sent` para siempre aunque SES ya publicaba sus eventos
 * acá. Espejo de `law-analytics-server/controllers/sesEventsController.js`
 * (mismos campos: status con precedencia, deliveredAt/openedAt/bouncedAt/
 * complainedAt/delayedAt, bounceType, sesEvents[-20]).
 */
const axios = require("axios");
const mongoose = require("mongoose");
const { NotificationLog } = require("../models");
const logger = require("../config/logger");

// ---------- emaillogs ----------
// Un rebote o una queja no se pisan con una entrega tardía.
const EMAILLOG_RANK = { failed: 0, sent: 1, delivered: 2, bounced: 3, complained: 4 };
const EMAILLOG_MAX_EVENTS = 20;

// Traduce un evento de SES a la actualización del emaillog. Pura.
const emailLogUpdateFromEvent = (ev) => {
  const type = ev?.eventType || ev?.notificationType;
  const messageId = ev?.mail?.messageId;
  if (!type || !messageId) return null;
  const set = {};
  let status = null;
  let at = null;
  let detail;
  switch (type) {
    case "Delivery":
      at = ev.delivery?.timestamp;
      set.deliveredAt = at ? new Date(at) : new Date();
      status = "delivered";
      break;
    case "Bounce":
      at = ev.bounce?.timestamp;
      set.bouncedAt = at ? new Date(at) : new Date();
      set.bounceType = [ev.bounce?.bounceType, ev.bounce?.bounceSubType].filter(Boolean).join("/") || null;
      detail = set.bounceType || undefined;
      // Un rebote transitorio queda registrado pero no cambia el status.
      if (ev.bounce?.bounceType === "Permanent") status = "bounced";
      break;
    case "Complaint":
      at = ev.complaint?.timestamp;
      set.complainedAt = at ? new Date(at) : new Date();
      status = "complained";
      break;
    case "DeliveryDelay":
      at = ev.deliveryDelay?.timestamp;
      set.delayedAt = at ? new Date(at) : new Date();
      detail = ev.deliveryDelay?.delayType;
      break;
    case "Open":
      at = ev.open?.timestamp;
      set.openedAt = at ? new Date(at) : new Date();
      break;
    case "Reject":
    case "Rendering Failure":
    case "RenderingFailure":
      status = "failed";
      detail = ev.reject?.reason || ev.failure?.errorMessage;
      break;
    default:
      // Send, Click, Subscription: no se guardan en emaillogs.
      return null;
  }
  const event = { type, at: at ? new Date(at) : new Date(), ...(detail ? { detail: String(detail).slice(0, 120) } : {}) };
  return { messageId, set, event, status };
};

const actualizarEmailLog = async (message) => {
  const u = emailLogUpdateFromEvent(message);
  if (!u) return false;
  if (mongoose.connection?.readyState !== 1 || !mongoose.connection.db) return false;
  const col = mongoose.connection.db.collection("emaillogs");
  const log = await col.findOne({ sesMessageId: u.messageId }, { projection: { status: 1, openedAt: 1, deliveredAt: 1 } });
  if (!log) return false; // envío anterior a los logs, o de otro servicio
  const set = { ...u.set, updatedAt: new Date() };
  // Solo la primera entrega y la primera apertura.
  if (set.openedAt && log.openedAt) delete set.openedAt;
  if (set.deliveredAt && log.deliveredAt) delete set.deliveredAt;
  if (u.status && (EMAILLOG_RANK[u.status] ?? 0) > (EMAILLOG_RANK[log.status] ?? 0)) set.status = u.status;
  await col.updateOne(
    { _id: log._id },
    { $set: set, $push: { sesEvents: { $each: [u.event], $slice: -EMAILLOG_MAX_EVENTS } } }
  );
  return true;
};

// Marca el log como rebotado/quejado y deja el motivo, para poder cruzar
// después con el estado de la credencial o la salud del destinatario.
const actualizarLog = async (messageId, cambios, contexto) => {
  if (!messageId) return false;
  const res = await NotificationLog.updateMany(
    { "notification.delivery.sesMessageId": messageId },
    { $set: cambios }
  );
  if (res.modifiedCount === 0) {
    // Normal para correos anteriores al guardado de MessageId, o de otros
    // servicios que comparten el dominio de envío.
    logger.debug(`SES ${contexto}: sin NotificationLog para messageId ${messageId}`);
    return false;
  }
  logger.info(`SES ${contexto}: ${res.modifiedCount} log(s) actualizados [${messageId}]`);
  return true;
};

const procesarEvento = async (message) => {
  const tipo = message.eventType || message.notificationType;
  const messageId = message.mail?.messageId;

  switch (tipo) {
    case "Delivery":
      return actualizarLog(
        messageId,
        {
          "notification.status": "delivered",
          "notification.delivery.deliveredAt": new Date(message.delivery?.timestamp || Date.now()),
        },
        "Delivery"
      );

    case "Bounce": {
      // Los hard bounces son los que importan: dirección inexistente o
      // bloqueada. Los soft (buzón lleno, servidor caído) se reintentan solos.
      const esPermanente = message.bounce?.bounceType === "Permanent";
      return actualizarLog(
        messageId,
        {
          "notification.status": "failed",
          "notification.delivery.failureReason": `Bounce ${message.bounce?.bounceType || "?"}/${
            message.bounce?.bounceSubType || "?"
          }`,
          "notification.delivery.bouncePermanent": esPermanente,
        },
        `Bounce ${esPermanente ? "permanente" : "transitorio"}`
      );
    }

    case "Complaint":
      // El destinatario marcó el correo como spam: seguir enviándole daña la
      // reputación del dominio para todos los usuarios.
      return actualizarLog(
        messageId,
        {
          "notification.status": "failed",
          "notification.delivery.failureReason": "Complaint (marcado como spam)",
          "notification.delivery.complaint": true,
        },
        "Complaint"
      );

    case "DeliveryDelay":
      return actualizarLog(
        messageId,
        { "notification.delivery.failureReason": `DeliveryDelay: ${message.deliveryDelay?.delayType || "?"}` },
        "DeliveryDelay"
      );

    // Engagement (habilitado 2026-08-21 agregando OPEN/CLICK al Configuration
    // Set). Necesitan $inc/$min además de $set, así que no usan actualizarLog.
    case "Open": {
      if (!messageId) return false;
      const ts = new Date(message.open?.timestamp || Date.now());
      const res = await NotificationLog.updateMany(
        { "notification.delivery.sesMessageId": messageId },
        {
          $inc: { "notification.engagement.opens": 1 },
          $set: { "notification.engagement.lastOpenAt": ts },
          // $min crea el campo si no existe: registra la primera apertura.
          $min: { "notification.engagement.firstOpenAt": ts }
        }
      );
      if (res.modifiedCount > 0) logger.info(`SES Open: ${res.modifiedCount} log(s) [${messageId}]`);
      return res.modifiedCount > 0;
    }

    case "Click": {
      if (!messageId) return false;
      const ts = new Date(message.click?.timestamp || Date.now());
      const res = await NotificationLog.updateMany(
        { "notification.delivery.sesMessageId": messageId },
        {
          $inc: { "notification.engagement.clicks": 1 },
          $set: {
            "notification.engagement.lastClickAt": ts,
            "notification.engagement.lastClickUrl": (message.click?.link || "").slice(0, 500)
          }
        }
      );
      if (res.modifiedCount > 0) logger.info(`SES Click: ${res.modifiedCount} log(s) [${messageId}] -> ${message.click?.link || "?"}`);
      return res.modifiedCount > 0;
    }

    default:
      logger.debug(`SES: evento ignorado (${tipo})`);
      return false;
  }
};

exports.emailLogUpdateFromEvent = emailLogUpdateFromEvent;

exports.handleSnsNotification = async (req, res) => {
  try {
    // SNS manda Content-Type text/plain: el body puede venir sin parsear.
    const notification = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!notification || !notification.Type) {
      return res.status(400).json({ success: false, error: "Notificación sin Type" });
    }

    // Alta del endpoint: SNS pide confirmar visitando la URL que envía.
    if (notification.Type === "SubscriptionConfirmation") {
      if (!notification.SubscribeURL) {
        return res.status(400).json({ success: false, error: "Falta SubscribeURL" });
      }
      await axios.get(notification.SubscribeURL);
      logger.info(`Suscripción SNS confirmada (TopicArn: ${notification.TopicArn})`);
      return res.status(200).json({ success: true, message: "Suscripción confirmada" });
    }

    if (notification.Type === "UnsubscribeConfirmation") {
      logger.warn(`SNS: se dio de baja la suscripción (TopicArn: ${notification.TopicArn})`);
      return res.status(200).json({ success: true });
    }

    if (notification.Type !== "Notification") {
      return res.status(200).json({ success: true, message: `Tipo ignorado: ${notification.Type}` });
    }

    const message = typeof notification.Message === "string" ? JSON.parse(notification.Message) : notification.Message;
    await procesarEvento(message);
    try {
      await actualizarEmailLog(message);
    } catch (logErr) {
      logger.warn(`SES: no se pudo actualizar emaillogs (${logErr.message})`);
    }

    // Siempre 200: si respondemos error, SNS reintenta y puede terminar
    // dándonos de baja del tema.
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error(`Error procesando evento SES/SNS: ${error.message}`);
    return res.status(200).json({ success: false, error: error.message });
  }
};
