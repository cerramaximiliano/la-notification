const logger = require('../config/logger');
const jwt = require('jsonwebtoken');

// Almacena las conexiones de usuarios activos
const connectedUsers = new Map();

// Helper function to extract token from cookies
function extractTokenFromCookies(socket) {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) return null;
    
    const cookies = {};
    cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.trim().split('=');
        if (parts.length === 2) {
            cookies[parts[0]] = parts[1];
        }
    });
    
    // Try different cookie names
    const TOKEN_COOKIE_NAMES = ['authToken', 'auth_token', 'auth_token_temp', 'token', 'access_token', 'jwt', 'session'];
    for (const cookieName of TOKEN_COOKIE_NAMES) {
        if (cookies[cookieName]) {
            return cookies[cookieName];
        }
    }
    
    return null;
}

/**
 * Inicia o reinicia la verificación periódica del token para un socket.
 * Si el token vence, notifica al cliente y le da 30s para renovarlo antes de desconectar.
 */
function setupTokenVerification(socket, token, userId) {
    if (socket.tokenCheckInterval) {
        clearInterval(socket.tokenCheckInterval);
    }

    socket.tokenCheckInterval = setInterval(() => {
        try {
            jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            logger.warn(`Token vencido para usuario ${userId}, solicitando renovación`);
            socket.emit('token_refresh_needed');

            if (socket.tokenRefreshTimeout) clearTimeout(socket.tokenRefreshTimeout);
            socket.tokenRefreshTimeout = setTimeout(() => {
                logger.warn(`Usuario ${userId}: sin respuesta a token_refresh_needed, desconectando`);
                socket.disconnect(true);
            }, 30 * 1000);
        }
    }, 5 * 60 * 1000);
}

/**
 * Configura el servidor WebSocket
 * @param {Object} io - Instancia de socket.io
 */
function setupWebSocket(io) {
    // La instancia de io ya está guardada globalmente en app.js

    io.on('connection', (socket) => {
        logger.info(`Nueva conexión WebSocket: ${socket.id}`);

        // Autenticar al usuario cuando se conecta
        socket.on('authenticate', (userId) => {
            try {
                const token = socket.handshake.auth?.token || extractTokenFromCookies(socket);

                if (!token) {
                    socket.emit('authentication_error', 'Token requerido');
                    return;
                }

                if (!userId) {
                    socket.emit('authentication_error', 'Se requiere ID de usuario para autenticar');
                    return;
                }

                const decoded = jwt.verify(token, process.env.JWT_SECRET);

                if (decoded.id !== userId) {
                    socket.emit('authentication_error', 'Usuario no autorizado');
                    return;
                }

                setupTokenVerification(socket, token, userId);

                // Guardar la asociación usuarioId -> socket
                if (connectedUsers.has(userId)) {
                    connectedUsers.get(userId).add(socket.id);
                } else {
                    connectedUsers.set(userId, new Set([socket.id]));
                }

                logger.info(`Usuario ${userId} autenticado en conexión ${socket.id}`);
                socket.userId = userId;
                socket.join(`user-${userId}`);
                socket.emit('authenticated', { success: true });

                sendPendingAlerts(userId);
            } catch (error) {
                logger.error(`authenticate error [socket=${socket.id}, userId=${userId}]: ${error.name} - ${error.message}`);
                socket.emit('authentication_error', 'Token inválido');
            }
        });

        // Renovar token sin cerrar la conexión
        socket.on('re_authenticate', ({ token: newToken } = {}) => {
            const userId = socket.userId;
            try {
                if (!newToken) {
                    socket.emit('authentication_error', 'Token requerido');
                    return;
                }

                const decoded = jwt.verify(newToken, process.env.JWT_SECRET);

                if (decoded.id !== userId) {
                    socket.emit('authentication_error', 'Usuario no autorizado');
                    socket.disconnect(true);
                    return;
                }

                // Cancelar el timeout de desconexión pendiente
                if (socket.tokenRefreshTimeout) {
                    clearTimeout(socket.tokenRefreshTimeout);
                    socket.tokenRefreshTimeout = null;
                }

                setupTokenVerification(socket, newToken, userId);

                logger.info(`Usuario ${userId}: token renovado correctamente`);
                socket.emit('authenticated', { success: true });
            } catch (error) {
                logger.error(`re_authenticate error [socket=${socket.id}, userId=${userId}]: ${error.name} - ${error.message}`);
                socket.emit('authentication_error', 'Token inválido');
                socket.disconnect(true);
            }
        });

        // Manejar desconexión
        socket.on('disconnect', () => {
            if (socket.tokenCheckInterval) {
                clearInterval(socket.tokenCheckInterval);
            }
            if (socket.tokenRefreshTimeout) {
                clearTimeout(socket.tokenRefreshTimeout);
            }

            const userId = socket.userId;
            if (userId && connectedUsers.has(userId)) {
                // Eliminar este socket del conjunto de conexiones del usuario
                connectedUsers.get(userId).delete(socket.id);

                // Si no quedan más sockets para este usuario, eliminar la entrada
                if (connectedUsers.get(userId).size === 0) {
                    connectedUsers.delete(userId);
                }

                logger.info(`Usuario ${userId} desconectado (socket: ${socket.id})`);
            } else {
                logger.info(`Socket desconectado: ${socket.id}`);
            }
        });
    });

    logger.info('Servicio WebSocket configurado');
}

/**
 * Envía notificaciones pendientes a un usuario recién conectado
 * @param {string} userId - ID del usuario
 */
async function sendPendingAlerts(userId) {
    try {
        const Alert = require('../models/Alert');

        // Buscar alertas del usuario que no hayan sido entregadas
        const pendingAlerts = await Alert.find({
            userId: userId,
            delivered: { $ne: true }
        }).sort({ createdAt: -1 }).limit(10);

        if (pendingAlerts.length > 0) {
            // Enviar las alertas pendientes
            const io = global.io;
            io.to(`user-${userId}`).emit('pending_alerts', pendingAlerts);

            logger.info(`Se enviaron ${pendingAlerts.length} alertas pendientes al usuario ${userId}`);

            // Marcar las alertas como entregadas
            const alertIds = pendingAlerts.map(alert => alert._id);
            await Alert.updateMany(
                { _id: { $in: alertIds } },
                { $set: { delivered: true } }
            );
        }
    } catch (error) {
        logger.error(`Error al enviar alertas pendientes al usuario ${userId}: ${error.message}`);
    }
}

/**
 * Envía una alerta push a un usuario específico
 * @param {string} userId - ID del usuario
 * @param {Object} alert - Objeto de alerta
 */
async function sendPushAlert(userId, alert) {
    try {
        const io = global.io;

        // Si el usuario está conectado, enviar la alerta inmediatamente
        if (io && connectedUsers.has(userId)) {
            io.to(`user-${userId}`).emit('new_alert', alert);

            // Marcar como entregada si se envió correctamente
            await require('../models/Alert').findByIdAndUpdate(
                alert._id,
                { $set: { delivered: true } }
            );

            logger.info(`Alerta push enviada al usuario ${userId}`);
            return true;
        } else {
            logger.info(`Usuario ${userId} no está conectado, la alerta quedará pendiente`);
            return false;
        }
    } catch (error) {
        logger.error(`Error al enviar alerta push al usuario ${userId}: ${error.message}`);
        return false;
    }
}

/**
 * Obtiene el número de conexiones activas de un usuario
 * @param {string} userId - ID del usuario
 * @returns {number} Número de conexiones activas
 */
function getUserConnectionCount(userId) {
    if (connectedUsers.has(userId)) {
        return connectedUsers.get(userId).size;
    }
    return 0;
}

/**
 * Verifica si un usuario está conectado
 * @param {string} userId - ID del usuario
 * @returns {boolean} true si el usuario está conectado
 */
function isUserConnected(userId) {
    return connectedUsers.has(userId) && connectedUsers.get(userId).size > 0;
}

module.exports = {
    setupWebSocket,
    sendPushAlert,
    getUserConnectionCount,
    isUserConnected
};