// task.model.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

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

const taskSchema = new mongoose.Schema({
  name: { type: String, required: true },
  progress: { type: Number },
  done: { type: Number },
  checked: { type: Boolean, required: true, default: false },
  dueDate: { type: Date, required: true },
  dueTime: { // Nuevo campo para almacenar la hora original si se necesita
    type: String,
    required: false
  },
  priority: { type: String, enum: ['baja', 'media', 'alta'], default: 'media' },
  status: {
    type: String,
    enum: ['pendiente', 'en_progreso', 'revision', 'completada', 'cancelada'],
    default: 'pendiente'
  },
  attachments: [{
    name: { type: String },
    url: { type: String },
    type: { type: String }
  }],
  comments: [{
    text: { type: String },
    author: { type: String },
    date: { type: Date, default: Date.now }
  }],
  folderId: { type: String },
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
  description: { type: String },
  assignedTo: [{ type: String }], // Default se manejará en middleware
  reminders: [{
    date: { type: Date },
    sent: { type: Boolean, default: false }
  }],
  subtasks: [{
    name: { type: String },
    completed: { type: Boolean, default: false }
  }],
  // Campos para el sistema de notificaciones
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
  { timestamps: true }
);

// Middleware para normalizar dueDate a las 00:00:00 UTC del día especificado
taskSchema.pre('save', function (next) {
  if (this.isModified('dueDate')) {
    // Guardar la hora original en el campo dueTime (opcional)
    const originalDate = new Date(this.dueDate);
    const hours = originalDate.getUTCHours().toString().padStart(2, '0');
    const minutes = originalDate.getUTCMinutes().toString().padStart(2, '0');
    this.dueTime = `${hours}:${minutes}`;

    // Normalizar dueDate a las 00:00:00 UTC
    const normalizedDate = new Date(this.dueDate);
    normalizedDate.setUTCHours(0, 0, 0, 0);
    this.dueDate = normalizedDate;
  }

  // Continuar con el resto de los middlewares
  next();
});

// El resto de los middlewares debe venir después para evitar interferencias
// Middleware para document.save() - asignación y sincronización de estados
taskSchema.pre('save', function (next) {
  // Si es un documento nuevo y no tiene elementos asignados
  if (this.isNew && (!this.assignedTo || this.assignedTo.length === 0)) {
    // Asignar el userId como primer elemento del array assignedTo
    this.assignedTo = [this.userId];
  }

  // Sincronizar status y checked
  if (this.status === 'completada' || this.status === 'cancelada') {
    this.checked = true;
  } else if (this.isModified('status')) {
    this.checked = false;
  }

  // Si checked cambia a true y status no está en un estado final
  if (this.isModified('checked') && this.checked === true &&
    this.status !== 'completada' && this.status !== 'cancelada') {
    this.status = 'completada';
  }

  next();
});

// Middleware para findOneAndUpdate - también normalizamos dueDate
taskSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();

  // Normalizar dueDate si se está actualizando
  if (update.dueDate || (update.$set && update.$set.dueDate)) {
    const dueDate = update.dueDate || update.$set.dueDate;
    const originalDate = new Date(dueDate);

    // Guardar hora original
    const hours = originalDate.getUTCHours().toString().padStart(2, '0');
    const minutes = originalDate.getUTCMinutes().toString().padStart(2, '0');
    const dueTime = `${hours}:${minutes}`;

    // Normalizar a 00:00:00 UTC
    const normalizedDate = new Date(dueDate);
    normalizedDate.setUTCHours(0, 0, 0, 0);

    // Actualizar los campos
    if (update.dueDate) {
      update.dueDate = normalizedDate;
      update.dueTime = dueTime;
    } else if (update.$set) {
      update.$set.dueDate = normalizedDate;
      update.$set.dueTime = dueTime;
    }
  }

  // Continuar con el resto de la lógica de actualización
  if (update.status === 'completada' || update.status === 'cancelada') {
    this.updateOne({ $set: { checked: true } });
  }
  else if (update.status && update.status !== 'completada' && update.status !== 'cancelada') {
    this.updateOne({ $set: { checked: false } });
  }

  if (update.checked === true) {
    if (!update.status) {
      this.updateOne({ $set: { status: 'completada' } });
    }
  }

  next();
});

// Adaptamos updateOne y updateMany para manejar la normalización de dueDate
taskSchema.pre('updateOne', function (next) {
  const update = this.getUpdate();

  // Normalizar dueDate si se está actualizando
  if (update.$set && update.$set.dueDate) {
    const originalDate = new Date(update.$set.dueDate);

    // Guardar hora original
    const hours = originalDate.getUTCHours().toString().padStart(2, '0');
    const minutes = originalDate.getUTCMinutes().toString().padStart(2, '0');
    update.$set.dueTime = `${hours}:${minutes}`;

    // Normalizar a 00:00:00 UTC
    const normalizedDate = new Date(update.$set.dueDate);
    normalizedDate.setUTCHours(0, 0, 0, 0);
    update.$set.dueDate = normalizedDate;
  }

  // Resto de la lógica existente
  if (update.$set) {
    if (update.$set.status === 'completada' || update.$set.status === 'cancelada') {
      update.$set.checked = true;
    } else if (update.$set.status) {
      update.$set.checked = false;
    }

    if (update.$set.checked === true && !update.$set.status) {
      update.$set.status = 'completada';
    }
  }

  next();
});

// Middleware para updateMany
taskSchema.pre('updateMany', function (next) {
  const update = this.getUpdate();

  // Normalizar dueDate si se está actualizando
  if (update.$set && update.$set.dueDate) {
    const originalDate = new Date(update.$set.dueDate);

    // Guardar hora original
    const hours = originalDate.getUTCHours().toString().padStart(2, '0');
    const minutes = originalDate.getUTCMinutes().toString().padStart(2, '0');
    update.$set.dueTime = `${hours}:${minutes}`;

    // Normalizar a 00:00:00 UTC
    const normalizedDate = new Date(update.$set.dueDate);
    normalizedDate.setUTCHours(0, 0, 0, 0);
    update.$set.dueDate = normalizedDate;
  }

  // Resto de la lógica existente
  if (update.$set) {
    if (update.$set.status === 'completada' || update.$set.status === 'cancelada') {
      update.$set.checked = true;
    } else if (update.$set.status) {
      update.$set.checked = false;
    }

    if (update.$set.checked === true && !update.$set.status) {
      update.$set.status = 'completada';
    }
  }

  next();
});

// Índices para mejorar el rendimiento de las consultas
taskSchema.index({ userId: 1, dueDate: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ "notifications.date": 1, "notifications.type": 1 });

const Task = mongoose.model("Task", taskSchema);

module.exports = Task;