const mongoose = require("mongoose");

const notificationLogSchema = new mongoose.Schema({
  // Usuario al que se envió la notificación
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  
  // Tipo de entidad que generó la notificación
  entityType: {
    type: String,
    enum: ["event", "task", "movement", "alert", "custom"],
    required: true,
    index: true
  },
  
  // ID de la entidad que generó la notificación
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  
  // Información de la entidad en el momento del envío (snapshot)
  entitySnapshot: {
    type: {
      title: String,
      description: String,
      date: Date, // fecha del evento/vencimiento
      type: String, // tipo específico de la entidad
      amount: Number, // para movimientos
      priority: String // para tareas
    },
    default: {}
  },
  
  // Detalles de la notificación
  notification: {
    // Método de envío
    method: {
      type: String,
      enum: ["email", "browser", "webhook", "sms"],
      required: true
    },
    
    // Estado del envío
    status: {
      type: String,
      enum: ["created", "sent", "delivered", "failed", "pending", "retry"],
      default: "sent"
    },
    
    // Contenido de la notificación
    content: {
      subject: String,
      message: String,
      template: String, // plantilla utilizada si aplica
      data: mongoose.Schema.Types.Mixed // datos adicionales
    },
    
    // Información de entrega
    delivery: {
      attempts: {
        type: Number,
        default: 1
      },
      lastAttemptAt: Date,
      deliveredAt: Date,
      failureReason: String,
      recipientEmail: String,
      recipientPhone: String
    }
  },
  
  // Configuración utilizada para esta notificación
  config: {
    daysInAdvance: Number,
    notifyOnceOnly: Boolean,
    customConfig: mongoose.Schema.Types.Mixed
  },
  
  // Metadatos
  metadata: {
    ip: String,
    userAgent: String,
    source: String, // cron, manual, api, etc.
    sessionId: String,
    custom: mongoose.Schema.Types.Mixed
  },
  
  // Marca de tiempo
  sentAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // Para manejar notificaciones programadas
  scheduledFor: {
    type: Date,
    index: true
  },
  
  // TTL para limpiar registros antiguos (opcional)
  expiresAt: {
    type: Date,
    index: { expireAfterSeconds: 0 }
  }
}, {
  timestamps: true
});

// Índices compuestos para consultas comunes
notificationLogSchema.index({ userId: 1, sentAt: -1 });
notificationLogSchema.index({ entityType: 1, entityId: 1, sentAt: -1 });
notificationLogSchema.index({ "notification.status": 1, sentAt: -1 });
notificationLogSchema.index({ userId: 1, entityType: 1, sentAt: -1 });

// Método para crear log desde entidad
notificationLogSchema.statics.createFromEntity = async function(entityType, entity, notification, userId) {
  const log = new this({
    userId: userId || entity.userId,
    entityType,
    entityId: entity._id,
    entitySnapshot: {
      title: entity.title || entity.description,
      description: entity.description,
      date: entity.date || entity.dueDate || entity.expirationDate,
      type: entity.type,
      amount: entity.amount,
      priority: entity.priority
    },
    notification: {
      method: notification.method || "email",
      status: notification.status || "sent",
      content: notification.content || {},
      delivery: notification.delivery || {}
    },
    config: notification.config || {},
    metadata: notification.metadata || {},
    sentAt: notification.sentAt || new Date()
  });
  
  return await log.save();
};

// Método para obtener estadísticas
notificationLogSchema.statics.getStats = async function(userId, startDate, endDate) {
  const match = { userId };
  if (startDate || endDate) {
    match.sentAt = {};
    if (startDate) match.sentAt.$gte = new Date(startDate);
    if (endDate) match.sentAt.$lte = new Date(endDate);
  }
  
  return await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          entityType: "$entityType",
          method: "$notification.method",
          status: "$notification.status"
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: "$_id.entityType",
        methods: {
          $push: {
            method: "$_id.method",
            status: "$_id.status",
            count: "$count"
          }
        },
        total: { $sum: "$count" }
      }
    }
  ]);
};

module.exports = mongoose.model("NotificationLog", notificationLogSchema);