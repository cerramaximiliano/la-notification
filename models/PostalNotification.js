const mongoose = require("mongoose");

/**
 * Notificación de seguimiento postal (Correo Argentino).
 *
 * Espejo de JudicialMovement pero para los eventos que detecta
 * postal-tracking-service. A diferencia de los movimientos judiciales
 * (que se consolidan y entregan a una hora fija), estos avisos son
 * INMEDIATOS: el webhook envía en el acto y solo deja el documento en
 * 'pending' si el envío falla, para que lo levante el safe guard diario.
 */
const postalEventSchema = new mongoose.Schema({
  // _id del subdocumento en postal-trackings.history (idempotencia cruzada)
  sourceEventId: String,
  status: String,
  deliveryStatus: String,
  description: String,
  location: String,
  eventDate: Date
}, { _id: false });

const postalNotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },

  // Datos del envío postal
  tracking: {
    // _id del doc en postal-trackings
    trackingId: { type: String, required: true, index: true },
    codeId: String,
    numberId: String,
    folderId: String,
    folderName: String,
    // El envío llegó a un estado definitivo (entregado, devuelto...)
    isFinalStatus: { type: Boolean, default: false }
  },

  // Eventos nuevos a comunicar (uno o varios en el mismo email)
  events: {
    type: [postalEventSchema],
    default: []
  },

  // 'skipped' = descartado por preferencia del usuario o política.
  notificationStatus: {
    type: String,
    enum: ['pending', 'sent', 'failed', 'skipped'],
    default: 'pending',
    index: true
  },

  // Origen del documento: 'webhook' (worker) | 'safeguard' (barrido diario)
  source: {
    type: String,
    enum: ['webhook', 'safeguard'],
    default: 'webhook'
  },

  notifications: [{
    date: { type: Date, required: true },
    type: { type: String, required: true },
    success: { type: Boolean, required: true },
    details: { type: String, required: true }
  }],

  // Dedup: userId + trackingId + hash de los eventos incluidos
  uniqueKey: {
    type: String,
    unique: true,
    required: true
  }
}, {
  timestamps: true
});

postalNotificationSchema.index({ notificationStatus: 1, createdAt: 1 });

/**
 * Clave única del envío. Los eventos se identifican por su sourceEventId
 * (o por fecha|estado si el worker no lo mandó), así el mismo lote nunca
 * se notifica dos veces aunque el webhook se reintente.
 */
postalNotificationSchema.statics.generateUniqueKey = function (userId, trackingId, events) {
  const crypto = require('crypto');
  const firma = (events || [])
    .map(ev => ev.sourceEventId || `${ev.eventDate ? new Date(ev.eventDate).toISOString() : ''}|${ev.status || ''}`)
    .sort()
    .join(',');
  const hash = crypto.createHash('md5').update(firma).digest('hex').substring(0, 12);
  return `${userId}_${trackingId}_${hash}`;
};

module.exports = mongoose.model("PostalNotification", postalNotificationSchema);
