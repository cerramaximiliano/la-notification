const mongoose = require("mongoose");
const { Schema } = mongoose;

// Esquema para configuración específica de notificación
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

// Definimos un subschema para las preferencias del usuario
const UserPreferencesSchema = new Schema({
  // Zona horaria del usuario
  timeZone: {
    type: String,
    default: 'Europe/Madrid',
    trim: true
  },
  // Formato de fecha preferido (DD/MM/YYYY, MM/DD/YYYY, etc.)
  dateFormat: {
    type: String,
    default: 'DD/MM/YYYY',
    trim: true
  },
  // Preferencias de lenguaje
  language: {
    type: String,
    default: 'es',
    trim: true
  },
  // Tema de la interfaz
  theme: {
    type: String,
    enum: ['light', 'dark', 'system'],
    default: 'system'
  },
  // Preferencias de notificaciones
  notifications: {
    // Notificaciones generales
    enabled: { type: Boolean, default: true },

    // Tipos de canales de notificación
    channels: {
      email: { type: Boolean, default: true },
      browser: { type: Boolean, default: true },
      mobile: { type: Boolean, default: true }
    },

    // Notificaciones de usuario
    user: {
      enabled: { type: Boolean, default: true },

      // Estado simple (para mantener compatibilidad con controladores existentes)
      calendar: { type: Boolean, default: true },
      expiration: { type: Boolean, default: true },
      inactivity: { type: Boolean, default: true },

      // Configuración detallada para cada tipo de notificación
      calendarSettings: {
        type: NotificationSettingsSchema,
        default: () => ({})
      },
      expirationSettings: {
        type: NotificationSettingsSchema,
        default: () => ({})
      },
      inactivitySettings: {
        type: NotificationSettingsSchema,
        default: () => ({})
      }
    },

    // Notificaciones del sistema
    system: {
      enabled: { type: Boolean, default: true },
      alerts: { type: Boolean, default: true },
      news: { type: Boolean, default: true },
      userActivity: { type: Boolean, default: true },

      // Configuración detallada para cada tipo de notificación
      alertsSettings: {
        type: NotificationSettingsSchema,
        default: () => ({})
      },
      newsSettings: {
        type: NotificationSettingsSchema,
        default: () => ({})
      },
      userActivitySettings: {
        type: NotificationSettingsSchema,
        default: () => ({})
      }
    },

    // Otras notificaciones específicas (según la UI)
    otherCommunications: { type: Boolean, default: true },
    loginAlerts: { type: Boolean, default: true },

    // Configuración detallada para otras notificaciones
    otherCommunicationsSettings: {
      type: NotificationSettingsSchema,
      default: () => ({})
    },
    loginAlertsSettings: {
      type: NotificationSettingsSchema,
      default: () => ({})
    }
  }
}, { _id: false });

/**
 * Modelo User simplificado para el servicio de notificaciones
 * Solo incluye los campos necesarios para las referencias
 */
const UserSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    role: {
      type: String,
      enum: ['USER_ROLE', 'ADMIN_ROLE', 'PREMIUM_ROLE'],
      default: 'USER_ROLE'
    },
    active: {
      type: Boolean,
      default: true
    },
    // Preferencias de notificación

    // Preferencias del usuario
    preferences: {
      type: UserPreferencesSchema,
      default: () => ({})
    },
  },
  {
    timestamps: true
  }
);

// Índices
// email ya tiene índice único definido en el schema
UserSchema.index({ active: 1 });
UserSchema.index({ role: 1 });

const User = mongoose.model("User", UserSchema, "usuarios");
module.exports = User;