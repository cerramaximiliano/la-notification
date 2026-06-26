const mongoose = require("mongoose");

// Cédula / notificación electrónica recibida en el portal del letrado PJN.
// Espejo de JudicialMovement, pero para las notificaciones que levanta el worker
// pjn-bandeja-sync en la colección `pjn-notifications`. Se notifican en el MISMO
// email que los movimientos (sección "Notificaciones" arriba de "Movimientos").
const judicialCedulaSchema = new mongoose.Schema({
  // Usuario a notificar (dueño de la credencial cuyo CUIL recibió la cédula)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },

  // Datos del expediente (display)
  expediente: {
    id: { type: String, required: true },
    number: { type: Number },
    year: { type: Number },
    fuero: { type: String, required: true },
    caratula: { type: String, required: true }
  },

  // Datos de la cédula
  cedula: {
    sourceId: { type: Number, required: true }, // id del item en notif.pjn.gov.ar
    numeroCedula: { type: Number },
    fecha: { type: Date, required: true, index: true },
    tipo: { type: String, default: "Cédula" },
    detalle: { type: String },
    url: { type: String },
    oficina: { type: String },
    nombreAutor: { type: String }
  },

  notificationStatus: {
    type: String,
    enum: ['pending', 'sent', 'failed'],
    default: 'pending'
  },

  notificationSettings: {
    notifyAt: { type: Date, required: true },
    channels: [{
      type: String,
      enum: ['email', 'browser'],
      default: ['email', 'browser']
    }]
  },

  notifications: [{
    date: { type: Date, required: true },
    type: { type: String, required: true },
    success: { type: Boolean, required: true },
    details: { type: String, required: true }
  }],

  uniqueKey: {
    type: String,
    unique: true,
    required: true
  }
}, {
  timestamps: true
});

judicialCedulaSchema.index({ userId: 1, 'cedula.fecha': 1, notificationStatus: 1 });
judicialCedulaSchema.index({ 'notificationSettings.notifyAt': 1, notificationStatus: 1 });

// Clave única por usuario + id de la cédula en el portal (estable).
judicialCedulaSchema.statics.generateUniqueKey = function(userId, sourceId) {
  return `${userId}_cedula_${sourceId}`;
};

module.exports = mongoose.model("JudicialCedula", judicialCedulaSchema);
