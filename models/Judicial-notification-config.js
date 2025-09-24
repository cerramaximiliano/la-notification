const mongoose = require('mongoose');

/**
 * Modelo de configuración global para notificaciones de movimientos judiciales
 * Controla aspectos como horarios de envío, límites, y configuraciones generales
 */
const JudicialNotificationConfigSchema = new mongoose.Schema({
    // Identificador único de la configuración (solo debe existir un documento)
    configKey: {
        type: String,
        default: 'global',
        unique: true,
        required: true,
        enum: ['global'] // Solo permitir 'global' como valor
    },

    // Configuración de horarios de notificación
    notificationSchedule: {
        // Hora de envío de notificaciones diarias (formato 24h)
        dailyNotificationHour: {
            type: Number,
            default: 13, // 13:00 (1 PM)
            min: 0,
            max: 23,
            required: true
        },
        dailyNotificationMinute: {
            type: Number,
            default: 0,
            min: 0,
            max: 59,
            required: true
        },
        // Zona horaria para las notificaciones
        timezone: {
            type: String,
            default: 'America/Argentina/Buenos_Aires',
            required: true
        },
        // Días de la semana para enviar notificaciones (0=Domingo, 6=Sábado)
        activeDays: {
            type: [Number],
            default: [1, 2, 3, 4, 5], // Lunes a Viernes
            validate: {
                validator: function(days) {
                    return days.every(day => day >= 0 && day <= 6);
                },
                message: 'Los días deben estar entre 0 (Domingo) y 6 (Sábado)'
            }
        }
    },

    // Configuración de límites y throttling
    limits: {
        // Máximo de movimientos por notificación batch
        maxMovementsPerBatch: {
            type: Number,
            default: 100,
            min: 1,
            max: 1000
        },
        // Máximo de notificaciones por usuario por día
        maxNotificationsPerUserPerDay: {
            type: Number,
            default: 50,
            min: 1,
            max: 200
        },
        // Tiempo mínimo entre notificaciones del mismo expediente (en horas)
        minHoursBetweenSameExpediente: {
            type: Number,
            default: 24,
            min: 1,
            max: 168 // Una semana
        }
    },

    // Configuración de reintentos
    retryConfig: {
        // Número máximo de reintentos para webhook fallido
        maxRetries: {
            type: Number,
            default: 3,
            min: 1,
            max: 10
        },
        // Delay inicial entre reintentos (ms)
        initialRetryDelay: {
            type: Number,
            default: 1000,
            min: 100,
            max: 60000
        },
        // Factor de backoff exponencial
        backoffMultiplier: {
            type: Number,
            default: 2,
            min: 1,
            max: 5
        },
        // Timeout para requests al webhook (ms)
        webhookTimeout: {
            type: Number,
            default: 30000,
            min: 5000,
            max: 120000
        }
    },

    // Configuración de contenido de notificaciones
    contentConfig: {
        // Incluir carátula completa en notificaciones
        includeFullCaratula: {
            type: Boolean,
            default: true
        },
        // Máximo de caracteres para el detalle del movimiento
        maxDetalleLength: {
            type: Number,
            default: 500,
            min: 50,
            max: 2000
        },
        // Incluir link al expediente en PJN
        includeExpedienteLink: {
            type: Boolean,
            default: false
        },
        // Agrupar movimientos del mismo expediente
        groupMovementsByExpediente: {
            type: Boolean,
            default: true
        }
    },

    // Configuración de filtros
    filters: {
        // Tipos de movimientos a excluir de notificaciones
        excludedMovementTypes: {
            type: [String],
            default: []
        },
        // Palabras clave en detalles para excluir
        excludedKeywords: {
            type: [String],
            default: []
        },
        // Solo notificar movimientos con estos tipos (si está vacío, notifica todos)
        includedMovementTypes: {
            type: [String],
            default: []
        }
    },

    // Configuración de retención de datos
    dataRetention: {
        // Días para retener movimientos judiciales notificados
        judicialMovementRetentionDays: {
            type: Number,
            default: 60,
            min: 7,
            max: 365,
            required: true
        },
        // Días para retener logs de notificaciones
        notificationLogRetentionDays: {
            type: Number,
            default: 30,
            min: 7,
            max: 180
        },
        // Días para retener alertas entregadas
        alertRetentionDays: {
            type: Number,
            default: 30,
            min: 7,
            max: 180
        },
        // Habilitar limpieza automática
        autoCleanupEnabled: {
            type: Boolean,
            default: true
        },
        // Hora de ejecución de limpieza (formato 24h)
        cleanupHour: {
            type: Number,
            default: 3, // 3 AM
            min: 0,
            max: 23
        }
    },

    // URLs y endpoints
    endpoints: {
        // URL del servicio de notificaciones
        notificationServiceUrl: {
            type: String,
            default: 'http://notifications.lawanalytics.app',
            required: true
        },
        // Endpoint específico para movimientos judiciales
        judicialMovementsEndpoint: {
            type: String,
            default: '/api/judicial-movements/webhook/daily-movements',
            required: true
        },
        // URL alternativa para fallback
        fallbackServiceUrl: {
            type: String,
            default: null
        }
    },

    // Estado y control
    status: {
        // Si las notificaciones están habilitadas globalmente
        enabled: {
            type: Boolean,
            default: true,
            required: true
        },
        // Modo de operación
        mode: {
            type: String,
            enum: ['production', 'staging', 'development', 'maintenance'],
            default: 'production'
        },
        // Mensaje para modo mantenimiento
        maintenanceMessage: {
            type: String,
            default: 'El sistema de notificaciones está en mantenimiento'
        }
    },

    // Estadísticas
    stats: {
        lastNotificationSentAt: {
            type: Date,
            default: null
        },
        totalNotificationsSent: {
            type: Number,
            default: 0
        },
        totalMovementsProcessed: {
            type: Number,
            default: 0
        },
        lastError: {
            message: String,
            timestamp: Date,
            count: {
                type: Number,
                default: 0
            }
        }
    },

    // Metadata
    metadata: {
        createdBy: {
            type: String,
            default: 'system'
        },
        lastModifiedBy: {
            type: String,
            default: 'system'
        },
        version: {
            type: String,
            default: '1.0.0'
        },
        notes: {
            type: String,
            default: ''
        }
    }
}, {
    timestamps: true,
    collection: 'judicial-notification-configs'
});

// Índices
JudicialNotificationConfigSchema.index({ configKey: 1 }, { unique: true });
JudicialNotificationConfigSchema.index({ 'status.enabled': 1 });
JudicialNotificationConfigSchema.index({ 'status.mode': 1 });

// Métodos de instancia
JudicialNotificationConfigSchema.methods.getNotificationTime = function() {
    const now = new Date();
    const notificationTime = new Date(now);
    notificationTime.setHours(
        this.notificationSchedule.dailyNotificationHour,
        this.notificationSchedule.dailyNotificationMinute,
        0,
        0
    );
    return notificationTime;
};

JudicialNotificationConfigSchema.methods.isNotificationDay = function() {
    const today = new Date().getDay();
    return this.notificationSchedule.activeDays.includes(today);
};

JudicialNotificationConfigSchema.methods.shouldSendNotifications = function() {
    return this.status.enabled && 
           this.status.mode !== 'maintenance' && 
           this.isNotificationDay();
};

JudicialNotificationConfigSchema.methods.getWebhookUrl = function() {
    const baseUrl = this.status.mode === 'production' 
        ? this.endpoints.notificationServiceUrl 
        : (this.endpoints.fallbackServiceUrl || this.endpoints.notificationServiceUrl);
    
    return `${baseUrl}${this.endpoints.judicialMovementsEndpoint}`;
};

JudicialNotificationConfigSchema.methods.updateStats = function(success, movementsCount = 0, error = null) {
    if (success) {
        this.stats.lastNotificationSentAt = new Date();
        this.stats.totalNotificationsSent += 1;
        this.stats.totalMovementsProcessed += movementsCount;
        // Reset error count on success
        if (this.stats.lastError) {
            this.stats.lastError.count = 0;
        }
    } else if (error) {
        if (!this.stats.lastError || this.stats.lastError.message !== error.message) {
            this.stats.lastError = {
                message: error.message,
                timestamp: new Date(),
                count: 1
            };
        } else {
            this.stats.lastError.count += 1;
            this.stats.lastError.timestamp = new Date();
        }
    }
    return this.save();
};

// Métodos estáticos
JudicialNotificationConfigSchema.statics.getConfig = async function() {
    let config = await this.findOne({ configKey: 'global' });
    
    if (!config) {
        // Crear configuración por defecto si no existe
        config = await this.create({ configKey: 'global' });
    }
    
    return config;
};

JudicialNotificationConfigSchema.statics.updateConfig = async function(updates, modifiedBy = 'system') {
    const config = await this.getConfig();
    
    // Actualizar campos
    Object.keys(updates).forEach(key => {
        if (key !== '_id' && key !== 'configKey' && key !== 'createdAt') {
            config[key] = updates[key];
        }
    });
    
    // Actualizar metadata
    config.metadata.lastModifiedBy = modifiedBy;
    
    return await config.save();
};

// Middleware pre-save
JudicialNotificationConfigSchema.pre('save', function(next) {
    // Validar que solo exista un documento global
    if (this.configKey !== 'global') {
        return next(new Error('Solo se permite una configuración global'));
    }
    next();
});

// Crear el modelo
const JudicialNotificationConfig = mongoose.model('JudicialNotificationConfig', JudicialNotificationConfigSchema);

module.exports = JudicialNotificationConfig;