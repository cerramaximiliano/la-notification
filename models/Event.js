/**
 * Esquema actualizado para el modelo Event con soporte para alertas de navegador
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

// Esquema para las notificaciones
const NotificationSchema = new Schema({
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
  },
  notificationId: {
    type: String,
    required: false,
    sparse: true // Permite valores null pero garantiza unicidad cuando existe
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
      index: true
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
      index: true
    },
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: false,
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
    timestamps: true,
  }
);

// Índices para mejorar el rendimiento de las consultas
EventSchema.index({ userId: 1, start: 1 });
EventSchema.index({ browserAlertSent: 1, start: 1 });
EventSchema.index({ "notifications.date": 1, "notifications.type": 1 });

// Índice único compuesto para prevenir notificaciones duplicadas
EventSchema.index({ 
  _id: 1, 
  "notifications.notificationId": 1 
}, { 
  unique: true,
  sparse: true,
  background: true,
  partialFilterExpression: { "notifications.notificationId": { $exists: true } }
});

// Métodos helper para trabajar con notificaciones
EventSchema.methods.shouldSendBrowserAlert = function(userCalendarSettings) {
  // Si ya se envió una alerta del navegador y está configurado para notificar solo una vez
  if (this.browserAlertSent && 
      (this.notificationSettings?.notifyOnceOnly || 
      (!this.notificationSettings && userCalendarSettings?.notifyOnceOnly))) {
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

// Método para marcar un evento como notificado por navegador
EventSchema.methods.markBrowserAlertSent = function() {
  this.browserAlertSent = true;
  this.notifications.push({
    date: new Date(),
    type: 'browser',
    success: true,
    details: 'Alerta creada en el navegador'
  });
  return this;
};

// Método para calcular días hasta el evento
EventSchema.methods.daysUntilEvent = function() {
  if (!this.start) return null;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const eventDay = new Date(this.start);
  eventDay.setHours(0, 0, 0, 0);
  
  const diffTime = eventDay - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
};

// Método para verificar si un evento es para hoy
EventSchema.methods.isToday = function() {
  if (!this.start) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const eventDay = new Date(this.start);
  eventDay.setHours(0, 0, 0, 0);
  
  return eventDay.getTime() === today.getTime();
};

// Método para formatear la fecha y hora del evento
EventSchema.methods.getFormattedDateTime = function() {
  if (!this.start) return '';
  
  const eventDate = new Date(this.start);
  
  // Formatear fecha
  const day = eventDate.getDate().toString().padStart(2, '0');
  const month = (eventDate.getMonth() + 1).toString().padStart(2, '0');
  const year = eventDate.getFullYear();
  
  // Si es todo el día, solo devolver la fecha
  if (this.allDay) {
    return `${day}/${month}/${year} (Todo el día)`;
  }
  
  // Formatear hora
  const hour = eventDate.getHours();
  const minute = eventDate.getMinutes().toString().padStart(2, '0');
  const ampm = hour >= 12 ? 'p.m.' : 'a.m.';
  const hour12 = (hour % 12) || 12;
  
  return `${day}/${month}/${year} ${hour12}:${minute} ${ampm}`;
};

// Método para obtener el estado del evento
EventSchema.methods.getEventStatus = function() {
  const daysUntil = this.daysUntilEvent();
  
  if (daysUntil === 0) {
    return {
      severity: 'warning',
      message: 'Hoy'
    };
  } else if (daysUntil === 1) {
    return {
      severity: 'warning',
      message: 'Mañana'
    };
  } else if (daysUntil > 1 && daysUntil <= 3) {
    return {
      severity: 'info',
      message: `En ${daysUntil} días`
    };
  } else if (daysUntil > 3) {
    return {
      severity: 'info',
      message: 'Próximamente'
    };
  } else {
    // daysUntil es negativo, el evento ya pasó
    return {
      severity: 'default',
      message: 'Finalizado'
    };
  }
};

const Event = mongoose.model("Event", EventSchema);
module.exports = Event;