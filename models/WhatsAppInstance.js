const mongoose = require('mongoose');

// Registro de instancias/líneas de Evolution API — reemplaza el
// EVOLUTION_INSTANCE_NAME único por env var. Se administra como datos (por
// ahora vía scripts/whatsappInstances.js, mañana vía un endpoint admin) para
// poder cargar la línea recién cuando exista, y para soportar más de una.
//
// Varias instancias reparten el volumen de envío y aíslan el daño si una se
// banea — pero cada una sigue necesitando su propio warm-up y bajo volumen;
// esto no reemplaza el opt-in/rate-limit, solo reparte el riesgo.
const whatsAppInstanceSchema = new mongoose.Schema({
  // Nombre de la instancia tal como está vinculada en Evolution API — es lo
  // que se manda en la URL de /message/sendText/:instance.
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  label: {
    type: String, // ej "Línea 1 - Buenos Aires"
  },
  phoneNumber: {
    type: String, // E.164, informativo — no se usa para enrutar, solo para identificar la línea en logs/admin
  },
  status: {
    type: String,
    enum: ['pending_link', 'connected', 'disconnected', 'banned', 'disabled'],
    default: 'pending_link',
  },
  // Kill-switch manual, independiente de `status` — permite sacar una
  // instancia de rotación sin borrar el registro (ej. mientras se recupera).
  enabled: {
    type: Boolean,
    default: true,
  },
  // Tope informativo de mensajes/día de esta línea. Declarado para cuando se
  // implemente el enforcement (ver services/notificationPolicyService.js) —
  // todavía NO se aplica automáticamente en outbox.js.
  dailyLimit: {
    type: Number,
    default: 200,
  },
  warmupStartedAt: Date,
  notes: String,
  // Último connection.update recibido por el webhook (routes/whatsappWebhook.js):
  // el status pasa solo a connected/disconnected/banned según el evento.
  lastConnectionChange: Date,
  lastConnectionReason: String,
}, {
  timestamps: true,
  collection: 'whatsapp-instances',
});

module.exports = mongoose.model('WhatsAppInstance', whatsAppInstanceSchema);
