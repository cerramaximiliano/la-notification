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

// Esquema específico para configuración de inactividad de causas
const InactivitySettingsSchema = new Schema({
  // Días de anticipación para la notificación (default 5 días)
  daysInAdvance: {
    type: Number,
    default: 5
  },
  // Días de inactividad para alerta de caducidad (default 180 días = 6 meses)
  caducityDays: {
    type: Number,
    default: 180
  },
  // Días para alerta de prescripción (default 730 días = 2 años)
  prescriptionDays: {
    type: Number,
    default: 730
  },
  // Por defecto, notificar solo una vez
  notifyOnceOnly: {
    type: Boolean,
    default: true
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
      mobile: { type: Boolean, default: true },
      // Canal WhatsApp (opt-in, default false). Lo escribe el hub; acá solo se
      // lee para decidir si el digest de movimientos también sale por WhatsApp.
      whatsapp: { type: Boolean, default: false }
    },

    // Notificaciones de usuario
    user: {
      enabled: { type: Boolean, default: true },

      // Estado simple (para mantener compatibilidad con controladores existentes)
      calendar: { type: Boolean, default: true },
      expiration: { type: Boolean, default: true }, // Vencimientos de movimientos
      taskExpiration: { type: Boolean, default: true }, // Vencimientos de tareas
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
      taskExpirationSettings: {
        type: NotificationSettingsSchema,
        default: () => ({})
      },
      inactivitySettings: {
        type: InactivitySettingsSchema,
        default: () => ({})
      },

      // Notificaciones de seguimiento postal (Correo Argentino). Son
      // inmediatas: no tienen modo de agrupación.
      postalTracking: {
        enabled: { type: Boolean, default: true }
      },
      // Modo de notificación de movimientos judiciales:
      //   'scheduled' (default): entrega a la hora diaria configurada (p. ej. 19:00)
      //   'immediate': entrega en la próxima corrida del cron ni bien el
      //     worker/coordinador descubre el movimiento
      judicialMovements: {
        // Switch general de las notificaciones de movimientos (las cédulas
        // NO dependen de este flag: son notificaciones legales personales).
        enabled: { type: Boolean, default: true },
        mode: { type: String, enum: ['scheduled', 'immediate'], default: 'scheduled' }
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
    // Estado de la cuenta. La fuente de verdad la escribe law-analytics-server
    // sobre la MISMA colección `usuarios` usando el campo `isActive`.
    // Una cuenta con isActive=false está desactivada y NO debe recibir notificaciones.
    isActive: {
      type: Boolean,
      default: true
    },
    // Preferencias de notificación

    // Preferencias del usuario
    preferences: {
      type: UserPreferencesSchema,
      default: () => ({})
    },

    // Espejo del hub: si el usuario vinculó Google Calendar. Lo usa el banner
    // de invitación a sincronizar (emailBanners) — sin el campo en el schema,
    // Mongoose lo descarta al leer y el banner no puede segmentar.
    googleCalendarConnected: {
      type: Boolean,
      default: false
    },

    // Espejo del hub (law-analytics-server/models/User.js): teléfono verificado
    // por WhatsApp y consentimiento del canal. Solo lectura de este lado — el
    // dispatcher exige phoneVerified + optIn vigente + channels.whatsapp antes
    // de encolar. Sin estos campos en el schema, Mongoose los descarta al leer.
    phone: {
      type: String,
      default: null
    },
    phoneVerified: {
      type: Boolean,
      default: false
    },
    phoneVerifiedAt: {
      type: Date,
      default: null
    },
    whatsappOptIn: {
      accepted: { type: Boolean, default: false },
      acceptedAt: { type: Date, default: null },
      source: { type: String, default: null },
      revokedAt: { type: Date, default: null }
    },
    // Prueba del canal WhatsApp para el plan gratuito (la arranca el hub al
    // verificar el número). services/channels/whatsapp/access.js la evalúa
    // junto con featureGrants.whatsapp_channel y el plan (subscriptions).
    whatsappTrial: {
      startedAt: { type: Date, default: null },
      endsAt: { type: Date, default: null }
    },
    // Bypasses manuales por feature (admin → Feature grants). Mixed como en el
    // hub: { whatsapp_channel: true } o { whatsapp_channel: { granted, revokedAt, ... } }.
    featureGrants: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined
    },
  },
  {
    timestamps: true
  }
);

// Índices
// email ya tiene índice único definido en el schema
UserSchema.index({ isActive: 1 });
UserSchema.index({ role: 1 });

const User = mongoose.model("User", UserSchema, "usuarios");
module.exports = User;