const { SendEmailCommand } = require("@aws-sdk/client-ses");
const sesClient = require("../config/aws");
const logger = require("../config/logger");

// Envía por SES y DEVUELVE el resultado: `result.MessageId` es la llave que
// permite correlacionar después los eventos de entrega, rebote y queja que SES
// publica por SNS. Los callers que registran NotificationLog deben guardarlo —
// sin eso, el estado "sent" solo dice que SES aceptó el envío, no que llegó.
const sendEmail = async (to, subject, htmlBody, textBody) => {
  const params = {
    Source: "Law||Analytics <soporte@lawanalytics.app>", // Correo verificado en AWS SES
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
    return result;
  } catch (error) {
    logger.error(`Error al enviar correo a ${to}:`, error);
    throw error;
  }
};

module.exports = { sendEmail };
