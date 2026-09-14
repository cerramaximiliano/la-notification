const mongoose = require('mongoose');

// Mensajes ENTRANTES del canal (los salientes viven en whatsapp-outbox). Meta
// no guarda historial: sin esto no hay forma de reconstruir una conversación,
// auditar una baja o alimentar el bot. Un doc por mensaje recibido.
const whatsAppMessageSchema = new mongoose.Schema({
  providerMessageId: {
    type: String,
    index: true,
  },
  provider: {
    type: String,
    enum: ['baileys', 'meta'],
  },
  instanceName: String,
  phone: {
    type: String, // E.164 del remitente
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    default: null,
  },
  profileName: String,
  text: String,
  // Adjuntos: solo la referencia (id de media del provider + tipo); el binario
  // se descarga cuando el bot lo necesite (Meta: URL válida 5 min, id 7 días).
  media: {
    kind: String, // image | document | audio | video | sticker
    id: String,
    mimeType: String,
    filename: String,
  },
  // Qué hizo el sistema con el mensaje: verification | opt_out | auto_reply | ignored | bot
  handledAs: String,
  receivedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
  collection: 'whatsapp-messages',
});

whatsAppMessageSchema.index({ phone: 1, receivedAt: -1 });
// Un mismo evento puede llegar dos veces (reintentos del provider).
whatsAppMessageSchema.index({ provider: 1, providerMessageId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);
