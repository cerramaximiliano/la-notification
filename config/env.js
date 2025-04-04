const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const logger = require('./logger');


module.exports = async () => {
    // Crear instancia del cliente de SecretsManager
    const secretsManager = new SecretsManagerClient({ region: 'sa-east-1' });

    try {
        // Crear y enviar el comando para obtener el valor secreto
        const command = new GetSecretValueCommand({
            SecretId: 'arn:aws:secretsmanager:sa-east-1:244807945617:secret:env-8tdon8'
        });

        const response = await secretsManager.send(command);
        const secret = JSON.parse(response.SecretString);

        // Asignar valores (asumiendo que son variables globales, aunque sería mejor devolverlas)
        URLDB = secret.URLDB;
        CADUCIDAD_TOKEN = secret.CADUCIDAD_TOKEN;
        SEED = secret.SEED;
        AWS_SES_USER = secret.AWS_SES_KEY_ID;
        AWS_SES_PASS = secret.AWS_SES_ACCESS_KEY;
        SES_CONFIG = JSON.stringify({
            accessKeyId: secret.AWS_SES_KEY_ID,
            secretAccessKey: secret.AWS_SES_ACCESS_KEY,
            region: 'us-east-1',
        });

        // Crear string con todos los secretos
        let secretsString = "";
        Object.keys(secret).forEach((key) => {
            secretsString += `${key}=${secret[key]}\n`;
        });

        return secretsString;
    } catch (error) {
        logger.error(error);
        throw error;
    }
};