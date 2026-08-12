/**
 * Sugerencia de upgrade de plan para el banner del email de movimientos.
 *
 * Lee `planconfigs` (límite de carpetas y precio por plan, cache 5 min) y
 * `subscriptions` (plan actual del usuario) con acceso raw a las colecciones
 * — la-notification no tiene modelos propios de billing y solo necesita
 * lectura. Un usuario con carpetas archivadas llegó ahí porque su plan no
 * cubre el total: se sugiere el plan más barato cuyo límite alcance para
 * TODAS sus carpetas (activas + archivadas).
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');

const CACHE_TTL_MS = 5 * 60 * 1000;
let planCache = { plans: null, loadedAt: 0 };

// Estados de suscripción que consideramos "plan vigente" del usuario.
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

/**
 * Catálogo de planes activos ordenado por límite de carpetas ascendente.
 * [{ planId, displayName, folderLimit, price, currency }]
 */
async function getActivePlans() {
  const now = Date.now();
  if (planCache.plans && now - planCache.loadedAt < CACHE_TTL_MS) {
    return planCache.plans;
  }
  try {
    const docs = await mongoose.connection.db
      .collection('planconfigs')
      .find({ isActive: true })
      .project({ planId: 1, displayName: 1, resourceLimits: 1, pricingInfo: 1 })
      .toArray();

    const plans = docs
      .map((d) => {
        const folders = (d.resourceLimits || []).find((r) => r.name === 'folders');
        return {
          planId: d.planId,
          displayName: (d.displayName || d.planId).replace(/\s*\(.*\)\s*$/, ''), // "Plan Premium (production)" → "Plan Premium"
          folderLimit: folders && Number.isFinite(folders.limit) ? folders.limit : null,
          price: d.pricingInfo && Number.isFinite(d.pricingInfo.basePrice) ? d.pricingInfo.basePrice : null,
          currency: (d.pricingInfo && d.pricingInfo.currency) || 'USD'
        };
      })
      .filter((p) => p.folderLimit !== null)
      .sort((a, b) => a.folderLimit - b.folderLimit);

    if (plans.length > 0) {
      planCache = { plans, loadedAt: now };
    }
    return plans;
  } catch (error) {
    logger.warn(`[PlanSuggestion] No se pudo leer planconfigs: ${error.message}`);
    return planCache.plans || [];
  }
}

/** planId vigente del usuario según `subscriptions` (default 'free'). */
async function getUserPlanId(userId) {
  try {
    const sub = await mongoose.connection.db
      .collection('subscriptions')
      .find({ user: new mongoose.Types.ObjectId(String(userId)), status: { $in: LIVE_SUBSCRIPTION_STATUSES } })
      .sort({ updatedAt: -1 })
      .limit(1)
      .toArray();
    return (sub[0] && sub[0].plan) || 'free';
  } catch (error) {
    logger.warn(`[PlanSuggestion] No se pudo leer subscription de ${userId}: ${error.message}`);
    return 'free';
  }
}

/**
 * Calcula la sugerencia de upgrade para un usuario con carpetas archivadas.
 *
 * @returns {Object|null} null si no corresponde banner (sin plan superior
 *   disponible, catálogo vacío, o el plan actual ya cubre el total).
 *   Si corresponde: { archivedCount, activeCount, totalNeeded,
 *     current: {planId, displayName, folderLimit},
 *     suggested: {planId, displayName, folderLimit, price, currency},
 *     coversAll: boolean }  // false si ni el plan más alto llega al total
 */
async function suggestPlanUpgrade(userId, { archivedCount, activeCount }) {
  if (!archivedCount || archivedCount <= 0) return null;

  const plans = await getActivePlans();
  if (plans.length === 0) return null;

  const currentId = await getUserPlanId(userId);
  const current = plans.find((p) => p.planId === currentId) || plans[0];

  const totalNeeded = archivedCount + (activeCount || 0);

  // Solo planes estrictamente superiores al actual.
  const upgrades = plans.filter((p) => p.folderLimit > current.folderLimit);
  if (upgrades.length === 0) return null; // ya está en el tope

  const covering = upgrades.find((p) => p.folderLimit >= totalNeeded);
  const suggested = covering || upgrades[upgrades.length - 1];

  return {
    archivedCount,
    activeCount: activeCount || 0,
    totalNeeded,
    current: { planId: current.planId, displayName: current.displayName, folderLimit: current.folderLimit },
    suggested,
    coversAll: Boolean(covering)
  };
}

function invalidatePlanCache() {
  planCache = { plans: null, loadedAt: 0 };
}

module.exports = { suggestPlanUpgrade, getActivePlans, getUserPlanId, invalidatePlanCache };
