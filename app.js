const express = require("express");
const dotenv = require('dotenv');
const retrieveSecrets = require('./config/env');
const fs = require('fs/promises');
const logger = require("./config/logger");
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const PORT = process.env.PORT_NOTIFICATIONS || 3004;
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*", // Permitir conexiones desde cualquier origen en desarrollo
        methods: ["GET", "POST"]
    }
});

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

        // Configurar el WebSocket en un módulo separado
        const websocketService = require('./services/websocket');
        websocketService.setupWebSocket(io);

        const { setupCronJobs } = require("./config/cron");
        setupCronJobs();

        // Iniciar el servidor HTTP con WebSocket integrado
        server.listen(PORT, () => {
            logger.info(`Servidor iniciado en el puerto ${PORT} con soporte WebSocket`);
        });

    } catch (error) {
        logger.error(`Error configurando la aplicación: ${error.message}`);
        process.exit(1); // Terminar la aplicación si la inicialización falla
    }
};

const mongoose = require('mongoose');

// Exportar io para usarlo en otros módulos
global.io = io;

// Proceso para mantener la aplicación viva
setInterval(() => {
    logger.debug('Keepalive check running...');
}, 300000); // Cada 5 minutos

process.on('SIGINT', async () => {
    logger.info('Cerrando conexión a la base de datos...');
    await mongoose.connection.close();
    logger.info('Conexión a la base de datos cerrada');
    process.exit(0);
});

initializeApp();