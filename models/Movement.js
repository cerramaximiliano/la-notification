const mongoose = require('mongoose');

// Esquema para las notificaciones
const NotificationSchema = new mongoose.Schema({
  notificationId: {
    type: String,
    required: false,  // Opcional para retrocompatibilidad
    sparse: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  type: {
    type: String,
    required: true,
    enum: ['email', 'browser', 'push', 'sms', 'other']
  },
  success: {
    type: Boolean,
    required: true,
    default: true
  },
  details: {
    type: String,
    required: false
  }
}, { _id: false });

const MovementSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserGroup',
      required: false,
      index: true
    },
    folderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Folder',
      required: true,
      index: true
    },
    time: {
      type: Date,
      required: true
    },
    dateExpiration: {
      type: Date,  // Cambiado de String a Date
      required: false,
      index: true
    },
    movement: {
      type: String,
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true // Elimina espacios en blanco al inicio y final
    },
    description: {
      type: String,
      required: false,
      trim: true
    },
    link: {
      type: String,
      required: false,
      trim: true,
    },
    // Nueva propiedad para controlar notificaciones del navegador
    browserAlertSent: {
      type: Boolean,
      default: false,
      index: true
    },
    // Campo para el sistema de notificaciones
    notifications: {
      type: [NotificationSchema],
      default: []
    },
    // Configuración de notificaciones
    notificationSettings: {
      // Por defecto, notificar solo una vez
      notifyOnceOnly: {
        type: Boolean,
        default: true
      },
      // Días de anticipación para la notificación
      daysInAdvance: {
        type: Number,
        default: 5
      }
    }
  },
  {
    timestamps: true, // Agrega createdAt y updatedAt
    versionKey: false // Elimina el campo __v
  }
);

// Índice compuesto para mejorar consultas de notificaciones
MovementSchema.index({ userId: 1, dateExpiration: 1 });
MovementSchema.index({ browserAlertSent: 1, dateExpiration: 1 });
MovementSchema.index({ "notifications.date": 1, "notifications.type": 1 });

// Métodos helper para trabajar con notificaciones
MovementSchema.methods.shouldSendBrowserAlert = function(userExpirationSettings) {
  // Si ya se envió una alerta del navegador y está configurado para notificar solo una vez
  if (this.browserAlertSent && 
      (this.notificationSettings?.notifyOnceOnly || 
      (!this.notificationSettings && userExpirationSettings?.notifyOnceOnly))) {
    return false;
  }
  
  // Verificar si ya se envió una notificación hoy
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const sentToday = this.notifications.some(n => 
    n.type === 'browser' && 
    n.date >= today && 
    n.date < tomorrow
  );
  
  return !sentToday;
};

// Método para marcar un movimiento como notificado por navegador
MovementSchema.methods.markBrowserAlertSent = function() {
  const crypto = require('crypto');
  const now = new Date();
  
  // Generar ID único para la notificación
  const notificationId = crypto.createHash('md5')
    .update(`${this.userId}-${this._id}-browser-${now.getTime()}`)
    .digest('hex');
  
  this.browserAlertSent = true;
  this.notifications.push({
    notificationId: notificationId,
    date: now,
    type: 'browser',
    success: true,
    details: 'Alerta creada en el navegador'
  });
  return this;
};

// Método para determinar si un movimiento está vencido
MovementSchema.methods.isExpired = function() {
  if (!this.dateExpiration) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expirationDate = new Date(this.dateExpiration);
  expirationDate.setHours(0, 0, 0, 0);
  
  return expirationDate < today;
};

// Método para calcular días hasta el vencimiento
MovementSchema.methods.daysUntilExpiration = function() {
  if (!this.dateExpiration) return null;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expirationDate = new Date(this.dateExpiration);
  expirationDate.setHours(0, 0, 0, 0);
  
  const diffTime = Math.abs(expirationDate - today);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
};

const Movement = mongoose.model('Movement', MovementSchema);

module.exports = Movement;