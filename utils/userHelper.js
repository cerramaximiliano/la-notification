/**
 * Helper para manejar información de usuarios en el servicio de notificaciones
 * Como este es un microservicio, los usuarios pueden no existir localmente
 */

const { User } = require('../models');
const logger = require('../config/logger');

// Cache temporal de usuarios para reducir consultas
const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Obtiene información del usuario, ya sea de la DB local o del cache
 * Si no existe, devuelve información básica con el ID
 */
async function getUserInfo(userId) {
  if (!userId) return null;
  
  const cacheKey = userId.toString();
  
  // Verificar cache
  const cached = userCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  
  try {
    // Intentar obtener de la DB local
    const user = await User.findById(userId).select('name email role').lean();
    
    if (user) {
      // Guardar en cache
      userCache.set(cacheKey, {
        data: user,
        expires: Date.now() + CACHE_TTL
      });
      return user;
    }
  } catch (error) {
    logger.debug(`Usuario ${userId} no encontrado localmente, usando ID`);
  }
  
  // Si no existe localmente, devolver objeto básico
  const basicUser = {
    _id: userId,
    name: `Usuario ${userId.toString().slice(-6)}`,
    email: null
  };
  
  // Cache negativo (más corto)
  userCache.set(cacheKey, {
    data: basicUser,
    expires: Date.now() + 60000 // 1 minuto
  });
  
  return basicUser;
}

/**
 * Enriquece una lista de documentos con información de usuario
 */
async function enrichWithUserInfo(documents, userField = 'userId') {
  if (!Array.isArray(documents)) return documents;
  
  // Obtener IDs únicos
  const userIds = [...new Set(documents.map(doc => doc[userField]?.toString()).filter(Boolean))];
  
  // Pre-cargar usuarios
  const userMap = new Map();
  await Promise.all(
    userIds.map(async (userId) => {
      const userInfo = await getUserInfo(userId);
      userMap.set(userId.toString(), userInfo);
    })
  );
  
  // Enriquecer documentos
  return documents.map(doc => {
    const userId = doc[userField]?.toString();
    if (userId && userMap.has(userId)) {
      doc[userField] = userMap.get(userId);
    }
    return doc;
  });
}

/**
 * Limpia el cache de usuarios
 */
function clearUserCache() {
  userCache.clear();
}

// Limpiar cache periódicamente
setInterval(clearUserCache, 30 * 60 * 1000); // 30 minutos

module.exports = {
  getUserInfo,
  enrichWithUserInfo,
  clearUserCache
};