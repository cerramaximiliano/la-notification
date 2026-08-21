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
 * PENDIENTE DE INFRAESTRUCTURA (consola AWS, no se puede hacer por código):
 *   1. Crear un tema SNS (p.ej. `ses-notification-events`).
 *   2. Crear un Configuration Set en SES que publique Delivery/Bounce/
 *      Complaint/DeliveryDelay a ese tema.
 *   3. Pasar ese Configuration Set en el SendEmailCommand de services/email.js
 *      (parámetro ConfigurationSetName).
 *   4. Suscribir este endpoint al tema: POST https://<host>/api/ses-events
 *      La confirmación de suscripción se auto-acepta más abajo.
 */
const axios = require("axios");
const { NotificationLog } = require("../models");
const logger = require("../config/logger");

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

    // Siempre 200: si respondemos error, SNS reintenta y puede terminar
    // dándonos de baja del tema.
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error(`Error procesando evento SES/SNS: ${error.message}`);
    return res.status(200).json({ success: false, error: error.message });
  }
};
