const mongoose = require('mongoose');

// Un doc por teléfono que interactuó con el canal. Su uso principal es la
// "ventana de servicio" de 24 h de Meta: si el usuario nos escribió hace
// menos de 24 h, se le puede responder/avisar con texto libre (gratis); si no,
// el aviso tiene que salir como plantilla aprobada (paga). También sirve para
// el bot (última interacción, nombre de perfil).
const whatsAppContactSchema = new mongoose.Schema({
  phone: {
    type: String, // E.164
    required: true,
    unique: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    default: null,
  },
  profileName: String,
  lastInboundAt: Date,
  lastOutboundAt: Date,
  // Por qué línea/instancia habló la última vez (para responder por la misma).
  lastInstanceName: String,
  // Estado conversacional del bot: intent que espera un dato más (ej. "buscar
  // carpeta" espera el texto a buscar). Vence solo (BOT_STATE_TTL_MS en bot.js).
  bot: {
    pendingIntent: { type: String, default: null },
    pendingSince: { type: Date, default: null },
  },
}, {
  timestamps: true,
  collection: 'whatsapp-contacts',
});

// Ventana de 24 h de Meta contada desde el último mensaje del usuario.
whatsAppContactSchema.statics.isServiceWindowOpen = function (contact, now = Date.now()) {
  if (!contact || !contact.lastInboundAt) return false;
  return now - new Date(contact.lastInboundAt).getTime() < 24 * 60 * 60 * 1000;
};

module.exports = mongoose.model('WhatsAppContact', whatsAppContactSchema);
