const { SendEmailCommand } = require("@aws-sdk/client-ses");
const sesClient = require("../config/aws");
const logger = require("../config/logger");

// Función para enviar correos electrónicos
const sendEmail = async (to, subject, htmlBody, textBody) => {
  const params = {
    Source: "soporte@lawanalytics.app", // Correo verificado en AWS SES
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
    logger.info(`Correo enviado a ${to}:`, result);
    return result;
  } catch (error) {
    logger.error(`Error al enviar correo a ${to}:`, error);
    throw error;
  }
};

module.exports = { sendEmail };
