// event.model.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const NotificationSchema = new Schema({
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

const EventSchema = new Schema(
  {
    allDay: {
      type: Boolean,
      required: true,
    },
    color: {
      type: String,
      required: false,
    },
    description: {
      type: String,
      required: false,
    },
    start: {
      type: Date,
      required: true,
    },
    end: {
      type: Date,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    folderId: {
      type: String,
      required: false,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: false,
    },
    // Campo para rastrear las notificaciones enviadas
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
      // Opcional: días de anticipación para la notificación
      daysInAdvance: {
        type: Number,
        default: 5
      }
    }
  },
  {
    timestamps: true,
  }
);

const Event = mongoose.model("Event", EventSchema);
module.exports = Event;