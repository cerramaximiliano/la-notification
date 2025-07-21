const jwt = require("jsonwebtoken");
const User = require("../models/User");
const logger = require("../config/logger");
const moment = require("moment");

// Configuración de JWT y cookies
const JWT_CONFIG = {
  secret: process.env.JWT_SECRET,
  algorithm: 'HS256'
};

const COOKIE_NAMES = {
  AUTH_TOKEN: 'authToken'
};

const TOKEN_COOKIE_NAMES = ['authToken', 'auth_token', 'auth_token_temp', 'token', 'access_token', 'jwt', 'session'];

// Helper para obtener token de cookies
const getTokenFromCookies = (cookies) => {
  if (!cookies) return null;

  for (const cookieName of TOKEN_COOKIE_NAMES) {
    if (cookies[cookieName]) {
      return cookies[cookieName];
    }
  }
  return null;
};

// Middleware principal para verificar token
const verifyToken = async (req, res, next) => {
  // Obtener token de la cookie, encabezado Authorization o query param
  const tokenFromCookie = getTokenFromCookies(req.cookies);
  const tokenFromHeader = req.headers.authorization?.split(' ')[1]; // "Bearer TOKEN"
  const tokenFromQuery = req.query?.token;

  const token = tokenFromCookie || tokenFromHeader || tokenFromQuery;

  if (!token) {
    logger.warn(`Middleware auth: Token no encontrado para ruta ${req.originalUrl}`);
    return res.status(401).json({
      message: "No token, authorization denied",
      needRefresh: true
    });
  }

  try {
    // Verificar token con el secreto JWT (usando SEED como fallback si JWT_SECRET no está definido)
    const jwtSecret = process.env.JWT_SECRET || process.env.SEED;
    const decoded = jwt.verify(token, jwtSecret, {
      algorithms: ["HS256"]
    });


    // Verificar expiración
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp < currentTime) {
      logger.warn(`Middleware auth: Token expirado`);
      return res.status(401).json({
        message: "Token has expired",
        needRefresh: true
      });
    }

    // En un microservicio de notificaciones, no necesitamos verificar el usuario en DB local
    // Solo extraemos la información del token
    req.userId = decoded.id;
    const user = await User.findById(decoded.id);
    // Asignar información del usuario desde el token
    if (user && user.role) {
      req.user = {
        id: decoded.id,
        role: user.role,
        name: user.name,
        email: user.email,
      }
    } else {
      req.user = {
        id: decoded.id,
        role: decoded.role || decoded.userData?.role || 'USER_ROLE',
        name: decoded.name || decoded.userData?.name,
        email: decoded.email || decoded.userData?.email
      };
    }


    // Mantener compatibilidad con req.userData si existe
    if (decoded.userData) {
      req.userData = decoded.userData;
    }

    // Log para debugging (opcional)
    logger.debug(`Usuario autenticado desde token: ${req.user.id} - ${req.user.email || 'email no disponible'}`);

    // Continuar con el siguiente middleware
    next();
  } catch (error) {
    logger.error(`Middleware auth: Error de verificación de token: ${error.message}`);

    // Determinar el tipo de error para mensajes más específicos
    let message = "Token is not valid";
    if (error.name === 'TokenExpiredError') {
      message = "Token has expired";
    } else if (error.name === 'JsonWebTokenError') {
      message = error.message;
    }

    res.status(401).json({
      message: message,
      needRefresh: true
    });
  }
};


// Middleware para verificar si el usuario es admin
const isAdmin = async (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN_ROLE') {
    logger.warn(`Acceso denegado a ruta admin para usuario ${req.userId} con rol ${req.user?.role}`);
    return res.status(403).json({
      message: 'Acceso denegado. Se requieren permisos de administrador.'
    });
  }
  next();
};

// Middleware para verificar token de servicio (para webhooks internos)
const verifyServiceToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Token de servicio no proporcionado' 
      });
    }

    const token = authHeader.split(' ')[1];

    if (token !== serviceToken) {
      return res.status(401).json({ 
        success: false, 
        message: 'Token de servicio inválido' 
      });
    }

    next();
  } catch (error) {
    logger.error('Error verificando token de servicio:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error en la autenticación del servicio' 
    });
  }
};

// Para mantener compatibilidad con código existente
const authenticate = verifyToken;

module.exports = {
  verifyToken,
  isAdmin,
  JWT_CONFIG,
  COOKIE_NAMES,
  authenticate,
  verifyServiceToken
};