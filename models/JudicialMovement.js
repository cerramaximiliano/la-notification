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
// Nota: movimientoFecha debe estar en formato YYYY-MM-DD para consistencia
// Incluye hash del detalle para soportar múltiples movimientos del mismo tipo en el mismo día
judicialMovementSchema.statics.generateUniqueKey = function(userId, expedienteId, movimientoFecha, movimientoTipo, movimientoDetalle) {
  const crypto = require('crypto');

  // Normalizar fecha si viene como Date object o string ISO
  let fechaNormalizada = movimientoFecha;
  if (movimientoFecha instanceof Date) {
    fechaNormalizada = movimientoFecha.toISOString().split('T')[0];
  } else if (typeof movimientoFecha === 'string' && movimientoFecha.includes('T')) {
    // Si es ISO string con hora, extraer solo la fecha
    fechaNormalizada = movimientoFecha.split('T')[0];
  }

  // Generar hash corto del detalle para diferenciarlo de otros movimientos del mismo día/tipo
  // Usamos los primeros 8 caracteres del hash MD5 para mantener el uniqueKey relativamente corto
  const detalleHash = crypto
    .createHash('md5')
    .update(movimientoDetalle || '')
    .digest('hex')
    .substring(0, 8);

  return `${userId}_${expedienteId}_${fechaNormalizada}_${movimientoTipo}_${detalleHash}`;
};

module.exports = mongoose.model("JudicialMovement", judicialMovementSchema);