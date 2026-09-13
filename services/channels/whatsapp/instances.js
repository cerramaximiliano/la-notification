const crypto = require('crypto');
const logger = require('../../../config/logger');
const { WhatsAppInstance } = require('../../../models');

// Mismo patrón de cache que notificationPolicyService.js: TTL corto y, si la
// consulta a Mongo falla, se devuelve la copia stale en vez de nada — un
// blip de conexión no debe frenar el envío.
const CACHE_TTL_MS = 60 * 1000;
let cache = { instances: null, loadedAt: 0 };

async function getActiveInstances() {
  const now = Date.now();
  if (cache.instances && (now - cache.loadedAt) < CACHE_TTL_MS) {
    return cache.instances;
  }

  try {
    const instances = await WhatsAppInstance.find({ enabled: true, status: 'connected' })
      .sort({ name: 1 })
      .lean();
    cache = { instances, loadedAt: now };
    return instances;
  } catch (error) {
    logger.warn(`No se pudieron leer las instancias de WhatsApp (usando cache previa): ${error.message}`);
    return cache.instances || [];
  }
}

// Asignación determinística por usuario: mismo usuario → misma línea,
// mientras el conjunto de instancias activas no cambie. Es un hash simple,
// no una asignación persistida — si se agrega/saca una instancia, algunos
// usuarios pueden "moverse" de línea. Suficiente para el volumen inicial;
// si hace falta estabilidad estricta, persistir la asignación es el próximo paso.
function pickForUser(userId, instances) {
  if (!instances || instances.length === 0) return null;
  const hash = crypto.createHash('md5').update(String(userId)).digest('hex');
  const idx = parseInt(hash.slice(0, 8), 16) % instances.length;
  return instances[idx];
}

async function resolveForUser(userId) {
  const instances = await getActiveInstances();
  return pickForUser(userId, instances);
}

// Para revalidar una instancia que un mensaje ya tenía fijada: si en el
// medio se desactivó o se marcó banned/disconnected, no hay que seguir
// intentando por ahí.
async function findActive(name) {
  const instances = await getActiveInstances();
  return instances.find(i => i.name === name) || null;
}

function invalidateCache() {
  cache = { instances: null, loadedAt: 0 };
}

module.exports = { getActiveInstances, resolveForUser, findActive, invalidateCache };
