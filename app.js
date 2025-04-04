const express = require("express");
const dotenv = require('dotenv');
const retrieveSecrets = require('./config/env');
const fs = require('fs/promises');
const logger = require("./config/logger");

const app = express();
const PORT = process.env.PORT_NOTIFICATIONS || 3003;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

app.get("/", (req, res) => {
    res.send("API funcionando");
    logger.info("API funcionando");
});


const initializeApp = async () => {
    try {
        const secretsString = await retrieveSecrets();
        await fs.writeFile(".env", secretsString);
        dotenv.config();

        const connectDB = require("./config/db");
        connectDB();

        const { setupCronJobs } = require("./config/cron");
        setupCronJobs()

        app.listen(PORT, () => {
            logger.info(`Servidor iniciado en el puerto ${PORT}`);
        });

    } catch (error) {
        logger.error(`Error configurando la aplicación: ${error.message}`);
        process.exit(1); // Terminar la aplicación si la inicialización falla
    }
};

const mongoose = require('mongoose');

process.on('SIGINT', async () => {
    logger.info('Cerrando conexión a la base de datos...');
    await mongoose.connection.close();
    logger.info('Conexión a la base de datos cerrada');
    process.exit(0);
});




initializeApp();
