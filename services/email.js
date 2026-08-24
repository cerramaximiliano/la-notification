const { SendEmailCommand } = require("@aws-sdk/client-ses");
const sesClient = require("../config/aws");
const logger = require("../config/logger");

// Envía por SES y DEVUELVE el resultado: `result.MessageId` es la llave que
// permite correlacionar después los eventos de entrega, rebote y queja que SES
// publica por SNS. Los callers que registran NotificationLog deben guardarlo —
// sin eso, el estado "sent" solo dice que SES aceptó el envío, no que llegó.
// Configuration Set de SES: es lo que hace que SES publique los eventos de
// entrega/rebote/queja al tema SNS que consume /api/ses-events. Sin esto los
// correos salen igual, pero nunca sabemos si llegaron. Configurable por env
// para poder cambiarlo sin deploy; si se apunta a un set inexistente SES
// RECHAZA el envío, así que el default es el verificado en us-east-1.
const CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET || "notificaciones-judiciales";

// Auditoría central del ecosistema: cada envío queda en `emaillogs` (misma
// colección/shape que usan los workers y el hub), además del NotificationLog
// propio de cada flujo. Fire-and-forget: nunca frena ni propaga al caller.
const logEmailSent = async ({ to, subject, templateName, templateCategory, sesMessageId, status, errorMessage, metadata }) => {
  try {
    const mongoose = require("mongoose");
    if (mongoose.connection?.readyState !== 1 || !mongoose.connection.db) return;
    await mongoose.connection.db.collection("emaillogs").insertOne({
      to: (to || "").toLowerCase().trim(),
      userId: metadata?.userId || null,
      subject,
      templateCategory: templateCategory || "notification",
      templateName: templateName || "la-notification",
      sesMessageId: sesMessageId || null,
      status,
      errorMessage: errorMessage || null,
      metadata: metadata || {},
      source: "la-notification",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } catch (err) {
    logger.warn(`[emaillog] no se pudo registrar el envío a ${to}: ${err.message}`);
  }
};

// `logMeta` (opcional): { templateName, templateCategory, metadata } para emaillogs.
const sendEmail = async (to, subject, htmlBody, textBody, logMeta = {}) => {
  const params = {
    Source: "Law||Analytics <soporte@lawanalytics.app>", // Correo verificado en AWS SES
    ConfigurationSetName: CONFIGURATION_SET,
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: htmlBody,
        },
        Text: {
          Charset: "UTF-8",
          Data: textBody,
        },
      },
    },
  };

  try {
    const command = new SendEmailCommand(params);
    const result = await sesClient.send(command);
    logger.info(`Correo enviado a ${to} (MessageId: ${result?.MessageId || 'sin-id'})`);
    await logEmailSent({ to, subject, ...logMeta, sesMessageId: result?.MessageId, status: "sent" });
    return result;
  } catch (error) {
    logger.error(`Error al enviar correo a ${to}:`, error);
    await logEmailSent({ to, subject, ...logMeta, status: "failed", errorMessage: error.message });
    throw error;
  }
};

module.exports = { sendEmail };
