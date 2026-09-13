const mongoose = require('mongoose');

// Outbox persistente en Mongo (no Redis/BullMQ — la-notification no tiene esa
// infra y el volumen esperado no la justifica, ver docs/whatsapp/00-arquitectura.md).
// sendWhatsAppNotification() nunca llama al provider directamente: encola acá,
// y el cron de config/cron.js drena los `pending` con reintentos/backoff.
const whatsAppOutboxSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // Evita duplicados si el cron que encola se solapa o reintenta:
  // hash(userId + entityType + entityId + messageType).
  idempotencyKey: {
    type: String,
    required: true,
    unique: true,
  },

  to: {
    type: String, // E.164, ej "+5491155555555"
    required: true,
  },

  // Se resuelve recién al procesar (no al encolar) vía
  // services/channels/whatsapp/instances.js, y queda fijo desde ese momento
  // para que los reintentos salgan siempre por la misma línea — mandar el
  // mismo mensaje desde números distintos en cada intento se vería raro del
  // lado del usuario. Null mientras no haya ninguna instancia activa.
  instanceName: {
    type: String,
    default: null,
  },

  // Texto ya renderizado por services/channels/whatsapp/templates.js — a
  // diferencia del borrador original (pensado para Meta/HSM) no hay
  // templateName/variables: Evolution API no exige plantillas aprobadas.
  text: {
    type: String,
    required: true,
  },

  // Etiqueta informativa del tipo de digest, para reportes/filtros.
  messageType: {
    type: String,
    default: 'judicial_movement_digest',
  },

  entityType: {
    type: String,
    enum: ['judicial_movement', 'task', 'event', 'inactivity', 'seclo', 'otp', 'auto_reply'],
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
  },

  // 'expired': quedó pending más de WHATSAPP_OUTBOX_MAX_AGE_HOURS (default 48)
  // sin poder salir (típicamente, sin ninguna línea conectada). Un digest de
  // "novedades de hoy" no tiene sentido días después, y soltar el backlog
  // acumulado de golpe sobre una línea recién vinculada es lo peor que se le
  // puede hacer a una cuenta nueva.
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'expired'],
    default: 'pending',
    index: true,
  },

  providerMessageId: {
    type: String,
    index: true,
    sparse: true,
  },

  attempts: {
    type: Number,
    default: 0,
  },
  nextAttemptAt: {
    type: Date,
    default: Date.now,
  },
  failureReason: String,

  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  expiredAt: Date,
}, {
  timestamps: true,
  collection: 'whatsapp-outbox',
});

whatsAppOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
// Conteo de enviados por línea y día (tope dailyLimit de WhatsAppInstance).
whatsAppOutboxSchema.index({ instanceName: 1, sentAt: 1 });

module.exports = mongoose.model('WhatsAppOutbox', whatsAppOutboxSchema);
