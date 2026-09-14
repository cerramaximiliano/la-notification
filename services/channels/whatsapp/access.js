/**
 * Acceso al canal WhatsApp (avisos + bot) del lado de la-notification. Misma
 * regla que el hub (law-analytics-server/services/whatsappAccessService.js),
 * que es quien inscribe y arranca la prueba; acá solo se evalúa antes de
 * encolar un aviso o de que el bot responda:
 *
 *   featureGrants.whatsapp_channel  → 'grant'
 *   plan pago vigente (subscriptions) → 'plan'
 *   User.whatsappTrial.endsAt > now   → 'trial'
 *   sino                              → sin acceso ('trial_expired' | 'no_access')
 *
 * A diferencia del hub no mira status.whatsappOpenEnrollment: quien ya está
 * verificado sigue recibiendo aunque se cierre la inscripción (piloto).
 * `subscriptions` se lee crudo (la-notification no tiene modelo de billing),
 * igual que services/planSuggestion.js.
 */

const mongoose = require('mongoose');
const logger = require('../../../config/logger');

const PAID_PLANS = ['standard', 'pro', 'premium'];
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

function grantIsActive(value) {
  if (value === true) return true;
  return !!value && typeof value === 'object' && value.granted === true && !value.revokedAt;
}

async function getPaidPlan(userId) {
  const query = {
    user: new mongoose.Types.ObjectId(String(userId)),
    plan: { $in: PAID_PLANS },
    status: { $in: LIVE_SUBSCRIPTION_STATUSES },
  };
  if (process.env.NODE_ENV === 'production') query.testMode = { $ne: true };
  const docs = await mongoose.connection.db
    .collection('subscriptions')
    .find(query)
    .project({ plan: 1 })
    .sort({ updatedAt: -1 })
    .limit(1)
    .toArray();
  return docs[0]?.plan || null;
}

/**
 * @param {object} user  Doc/lean de `usuarios` con _id, featureGrants y whatsappTrial.
 * @returns {Promise<{ allowed: boolean, reason: 'grant'|'plan'|'trial'|'trial_expired'|'no_access', plan: string|null, trialEndsAt: Date|null }>}
 */
async function resolveAccess(user) {
  const trialEndsAt = user?.whatsappTrial?.endsAt ? new Date(user.whatsappTrial.endsAt) : null;
  const base = { plan: null, trialEndsAt };

  if (grantIsActive(user?.featureGrants?.whatsapp_channel)) {
    return { allowed: true, reason: 'grant', ...base };
  }

  let plan = null;
  try {
    plan = user?._id ? await getPaidPlan(user._id) : null;
  } catch (error) {
    logger.warn(`[WhatsApp access] No se pudo leer la suscripción de ${user?._id}: ${error.message}`);
  }
  if (plan) {
    return { allowed: true, reason: 'plan', ...base, plan };
  }
  if (trialEndsAt && trialEndsAt > new Date()) {
    return { allowed: true, reason: 'trial', ...base };
  }
  return { allowed: false, reason: trialEndsAt ? 'trial_expired' : 'no_access', ...base };
}

module.exports = { resolveAccess, grantIsActive, PAID_PLANS };
