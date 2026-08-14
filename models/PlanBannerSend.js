const mongoose = require('mongoose');

/**
 * Registro de banners de upgrade mostrados por usuario, para aplicar el
 * cooldown configurable (planBanner.cooldownDays del config doc). Un doc por
 * email enviado CON banner. TTL de 120 días (el cooldown máximo configurable
 * es 90) — la colección se mantiene chica sola.
 */
const planBannerSendSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  // Tipo de banner mostrado: 'plan' | 'feature' (habilita el cooldown
  // compartido entre banners promocionales).
  bannerKind: {
    type: String,
    default: 'plan',
    index: true
  },
  // Tipo de email donde se mostró (movimiento, calendario, tareas, ...)
  emailType: String,
  // Contexto para métricas (qué se sugirió y con cuántas archivadas)
  suggestedPlanId: String,
  archivedCount: Number,
  promoCode: String
}, {
  timestamps: false,
  collection: 'plan-banner-sends'
});

planBannerSendSchema.index({ sentAt: 1 }, { expireAfterSeconds: 120 * 24 * 3600 });
planBannerSendSchema.index({ userId: 1, sentAt: -1 });

module.exports = mongoose.model('PlanBannerSend', planBannerSendSchema);
