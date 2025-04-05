const mongoose = require("mongoose");
const { Schema } = mongoose;

// Esquema para la configuración de notificaciones
const NotificationSettingsSchema = new Schema({
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
}, { _id: false });

// Esquema para registrar notificaciones enviadas
const NotificationRecordSchema = new Schema({
  // Fecha en que se envió la notificación
  date: {
    type: Date,
    default: Date.now
  },
  // Tipo de notificación (email, browser, mobile)
  type: {
    type: String,
    enum: ['email', 'browser', 'push', 'sms', 'other'],
    required: true
  },
  // Si la notificación se envió correctamente
  success: {
    type: Boolean,
    default: true
  },
  // Detalles adicionales sobre la notificación
  details: {
    type: String
  }
}, { _id: false });

const TaskSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    folderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Folder',
      index: true
    },
    status: {
      type: String,
      enum: ['pendiente', 'en_progreso', 'revision', 'completada', 'cancelada'],
      default: 'pendiente',
      index: true
    },
    priority: {
      type: String,
      enum: ['baja', 'media', 'alta'],
      default: 'media',
      index: true
    },
    dueDate: {
      type: Date,
      required: true,
      index: true
    },
    dueTime: {
      type: String,
      validate: {
        validator: function (v) {
          return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
        },
        message: props => `${props.value} no es un formato de hora válido (HH:MM)`
      }
    },
    checked: {
      type: Boolean,
      default: false,
      index: true
    },

    // Nueva propiedad para controlar notificaciones del navegador
    browserAlertSent: {
      type: Boolean,
      default: false,
      index: true
    },

    // Registros de notificaciones enviadas
    notifications: {
      type: [NotificationRecordSchema],
      default: []
    },

    // Configuración de notificaciones específica para esta tarea
    // (si no está presente, se usa la configuración global del usuario)
    notificationSettings: {
      type: NotificationSettingsSchema
    }
  },
  {
    timestamps: true
  }
);

// Índices para mejorar el rendimiento de búsquedas comunes
TaskSchema.index({ userId: 1, status: 1, dueDate: 1 });
TaskSchema.index({ userId: 1, browserAlertSent: 1 });
TaskSchema.index({ "notifications.date": 1, "notifications.type": 1 });

// Métodos helper para trabajar con notificaciones
TaskSchema.methods.shouldSendBrowserAlert = function (userExpirationSettings) {
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

// Método para marcar una tarea como notificada por navegador
TaskSchema.methods.markBrowserAlertSent = function () {
  this.browserAlertSent = true;
  this.notifications.push({
    date: new Date(),
    type: 'browser',
    success: true,
    details: 'Alerta creada en el navegador'
  });
  return this;
};

// Método para determinar si una tarea está vencida
TaskSchema.methods.isOverdue = function () {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(this.dueDate);
  dueDate.setHours(0, 0, 0, 0);

  return dueDate < today;
};

// Método para calcular días hasta el vencimiento
TaskSchema.methods.daysUntilDue = function () {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(this.dueDate);
  dueDate.setHours(0, 0, 0, 0);

  const diffTime = dueDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
};

// Método para obtener el estado de la tarea
TaskSchema.methods.getStatusInfo = function () {
  const diffDays = this.daysUntilDue();

  if (diffDays < 0) {
    return {
      severity: 'error',
      message: 'Vencida',
      icon: 'warning'
    };
  } else if (diffDays === 0) {
    return {
      severity: 'warning',
      message: 'Vence hoy',
      icon: 'clock'
    };
  } else if (diffDays === 1) {
    return {
      severity: 'warning',
      message: 'Vence mañana',
      icon: 'clock'
    };
  } else if (diffDays <= 3) {
    return {
      severity: 'warning',
      message: `En ${diffDays} días`,
      icon: 'calendar'
    };
  } else {
    return {
      severity: 'info',
      message: `En ${diffDays} días`,
      icon: 'calendar'
    };
  }
};

// Método para formatear la fecha de vencimiento
TaskSchema.methods.getFormattedDueDate = function (format = 'DD/MM/YYYY') {
  const dueDate = new Date(this.dueDate);

  // Formato de fecha: DD/MM/YYYY
  const day = dueDate.getDate().toString().padStart(2, '0');
  const month = (dueDate.getMonth() + 1).toString().padStart(2, '0');
  const year = dueDate.getFullYear();

  let result = format;
  result = result.replace('DD', day);
  result = result.replace('MM', month);
  result = result.replace('YYYY', year);

  // Agregar hora si existe
  if (this.dueTime) {
    const [hours, minutes] = this.dueTime.split(':');
    const hour12 = (parseInt(hours) % 12) || 12;
    const ampm = parseInt(hours) >= 12 ? 'p.m.' : 'a.m.';
    result += ` ${hour12}:${minutes} ${ampm}`;
  }

  return result;
};

const Task = mongoose.model("Task", TaskSchema);
module.exports = Task;