const mongoose = require("mongoose");

const AlertSchema = new mongoose.Schema(
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
        avatarType: {
            type: String,
            required: false,
        },
        avatarIcon: {
            type: String,
            enum: ["Gift", "MessageText1", "Setting2", "TableDocument", "TaskSquare", "CalendarRemove"],
            required: false,
        },
        avatarSize: {
            type: Number,
            required: false,
        },
        avatarInitial: {
            type: String,
            required: false,
        },
        // Mantenemos estos campos por compatibilidad con versiones anteriores
        // pero ya no son obligatorios
        primaryText: {
            type: String,
            required: false, // Cambiado de true a false
        },
        primaryVariant: {
            type: String,
            required: false, // Cambiado de true a false
        },
        secondaryText: {
            type: String,
            required: true,
        },
        // Nuevo campo para almacenar la fecha de expiración
        expirationDate: {
            type: Date,
            required: false, // No obligatorio para mantener compatibilidad con alertas antiguas
            index: true      // Indexado para consultas eficientes
        },
        actionText: {
            type: String,
            required: true,
        },
        // Campos para notificaciones push
        delivered: {
            type: Boolean,
            default: false,
            index: true
        },
        read: {
            type: Boolean,
            default: false
        },
        deliveryAttempts: {
            type: Number,
            default: 0
        },
        lastDeliveryAttempt: {
            type: Date
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
    }
);

// Índice compuesto para consultas frecuentes de alertas pendientes
AlertSchema.index({ userId: 1, delivered: 1, createdAt: -1 });

// Nuevo índice para consultas basadas en fechas de expiración
AlertSchema.index({ userId: 1, expirationDate: 1, read: 1 });

const Alert = mongoose.model("Alert", AlertSchema);
module.exports = Alert;