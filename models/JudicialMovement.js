const mongoose = require("mongoose");

const judicialMovementSchema = new mongoose.Schema({
  // Usuario a notificar
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  
  // Datos del expediente
  expediente: {
    id: { type: String, required: true }, // ID del expediente en el sistema principal
    number: { type: Number, required: true },
    year: { type: Number, required: true },
    fuero: { type: String, required: true },
    caratula: { type: String, required: true },
    objeto: String
  },
  
  // Movimiento específico a notificar
  movimiento: {
    fecha: { type: Date, required: true, index: true },
    tipo: { type: String, required: true },
    detalle: { type: String, required: true },
    url: String
  },
  
  // Estado de notificación
  notificationStatus: {
    type: String,
    enum: ['pending', 'sent', 'failed'],
    default: 'pending'
  },
  
  // Configuración de notificación
  notificationSettings: {
    notifyAt: { type: Date, required: true }, // Hora específica para notificar
    channels: [{
      type: String,
      enum: ['email', 'browser'],
      default: ['email', 'browser']
    }]
  },
  
  // Historial de intentos de notificación
  notifications: [{
    date: { type: Date, required: true },
    type: { type: String, required: true }, // email, browser
    success: { type: Boolean, required: true },
    details: { type: String, required: true }
  }],
  
  // Para evitar duplicados
  uniqueKey: {
    type: String,
    unique: true,
    required: true
  }
}, {
  timestamps: true
});

// Índice compuesto para búsquedas eficientes
judicialMovementSchema.index({ userId: 1, 'movimiento.fecha': 1, notificationStatus: 1 });
judicialMovementSchema.index({ 'notificationSettings.notifyAt': 1, notificationStatus: 1 });

// Método para generar clave única
judicialMovementSchema.statics.generateUniqueKey = function(userId, expedienteId, movimientoFecha, movimientoTipo) {
  return `${userId}_${expedienteId}_${movimientoFecha}_${movimientoTipo}`;
};

module.exports = mongoose.model("JudicialMovement", judicialMovementSchema);