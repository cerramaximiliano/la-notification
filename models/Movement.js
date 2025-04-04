const mongoose = require('mongoose');

// Esquema para las notificaciones
const NotificationSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  type: {
    type: String,
    required: true,
    enum: ['email', 'push', 'sms', 'other']
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
      type: String,
      required: true
    },
    dateExpiration: {
      type: Date,  // Cambiado de String a Date
      required: false
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

// Índice para mejorar el rendimiento de las consultas de notificaciones
MovementSchema.index({ "notifications.date": 1, "notifications.type": 1 });
// Índice para consultas por fecha de expiración
MovementSchema.index({ "dateExpiration": 1 });

const Movement = mongoose.model('Movement', MovementSchema);

module.exports = Movement;