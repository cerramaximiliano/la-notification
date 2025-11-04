const express = require("express");
const dotenv = require('dotenv');
const retrieveSecrets = require('./config/env');
const fs = require('fs/promises');
const logger = require("./config/logger");
const http = require('http');
const socketIO = require('socket.io');
const cookieParser = require('cookie-parser');
const chalk = require('chalk');

const app = express();
const PORT = process.env.PORT_NOTIFICATIONS || 3004;
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*", // Permitir conexiones desde cualquier origen en desarrollo
        credentials: true,
        methods: ["GET", "POST"]
    }
});

// Configurar CORS
app.use((req, res, next) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin || '*');
    }
    
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


app.use((req, res, next) => {
    // Colorear log específico para la ruta de webhook de movimientos judiciales
    if (req.method === 'POST' && req.url === '/api/judicial-movements/webhook/daily-movements') {
        console.log(chalk.bgCyan.bold.black(`${req.method} ${req.url}`));
    }
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
        await connectDB();
        
        // Cargar todos los modelos después de conectar a la DB
        require('./models');

        // Configurar rutas de monitoreo
        const monitoringRoutes = require('./routes/monitoring');
        app.use('/api/monitoring', monitoringRoutes);
        
        // Configurar rutas de alertas
        const alertRoutes = require('./routes/alerts');
        app.use('/api/alerts', alertRoutes);
        
        // Configurar rutas de movimientos judiciales
        const judicialMovementRoutes = require('./routes/judicialMovements');
        app.use('/api/judicial-movements', judicialMovementRoutes);

        // Exportar io globalmente antes de configurar WebSocket
        global.io = io;
        
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