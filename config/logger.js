// utils/logger.js
const winston = require("winston");
const { combine, timestamp, printf, colorize, errors } = winston.format;
require("dotenv").config();

// Configuración del formato de log
const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} ${level}: ${stack || message}`;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: combine(
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        errors({ stack: true }), // Incluye el stack trace en los logs de error
        logFormat
    ),
    transports: [
        // Log en la consola para desarrollo
        new winston.transports.Console({
            format: combine(colorize(), logFormat),
        }),
        // Log en archivo para producción
        new winston.transports.File({ filename: "logs/error.log", level: "error" }),
        new winston.transports.File({ filename: "logs/combined.log" }),
    ],
});

// Manejo de excepciones y rechazo de promesas no manejadas
logger.exceptions.handle(
    new winston.transports.File({ filename: "logs/exceptions.log" })
);
logger.rejections.handle(
    new winston.transports.File({ filename: "logs/rejections.log" })
);

module.exports = logger;