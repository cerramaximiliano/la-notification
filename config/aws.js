const { SESClient } = require('@aws-sdk/client-ses');
const logger = require('./logger');

// Verificar que las credenciales existan
if (!process.env.AWS_SES_KEY_ID || !process.env.AWS_SES_ACCESS_KEY) {
    logger.error('Error: AWS credentials not found. Make sure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are defined in your environment.');
    throw new Error('AWS credentials not found in environment variables');
}

// Configura el cliente SES con validación adicional
const sesClient = new SESClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_SES_KEY_ID,
        secretAccessKey: process.env.AWS_SES_ACCESS_KEY,
    },
});

// Verificar la configuración del cliente
logger.info('SES Client configured for region:', process.env.AWS_REGION || 'us-east-1');
logger.info('AWS credentials are present:', !!process.env.AWS_SES_KEY_ID && !!process.env.AWS_SES_ACCESS_KEY);

module.exports = sesClient;