const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const EmailTemplateSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      enum: [
        'subscription', 'auth', 'support', 'tasks', 'documents', 'notification', 'welcome',
        'calculadora', 'gestionTareas', 'gestionCausas', 'gestionContactos', 'gestionCalendario', 'secuenciaOnboarding',
        'promotional', 'booking', 'newsletter', 'transactional', 'reactivation', 'improved', 'ab-test'
      ],
      index: true
    },
    name: {
      type: String,
      required: true
    },
    subject: {
      type: String,
      required: true
    },
    preheader: {
      type: String,
      default: ''
    },
    htmlBody: {
      type: String
    },
    htmlContent: {
      type: String
    },
    textBody: {
      type: String
    },
    textContent: {
      type: String
    },
    description: {
      type: String,
      default: ''
    },
    variables: {
      type: [String],
      default: []
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    tags: {
      type: [String],
      default: [],
      index: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

// Crear índice compuesto para búsqueda eficiente por categoría y nombre
EmailTemplateSchema.index({ category: 1, name: 1 }, { unique: true });

// Índices adicionales para búsqueda por tags y metadata de IA
EmailTemplateSchema.index({ 'metadata.generatedBy': 1 });
EmailTemplateSchema.index({ 'metadata.generationParams.type': 1 });

// Virtual para obtener el contenido HTML (soporta ambos nombres de campo)
EmailTemplateSchema.virtual('html').get(function() {
  return this.htmlContent || this.htmlBody;
});

// Virtual para obtener el contenido de texto (soporta ambos nombres de campo)
EmailTemplateSchema.virtual('text').get(function() {
  return this.textContent || this.textBody;
});

// Middleware para asegurar que al menos un campo de contenido esté presente
EmailTemplateSchema.pre('validate', function(next) {
  if (!this.htmlBody && !this.htmlContent && !this.textBody && !this.textContent) {
    next(new Error('At least one content field (htmlBody, htmlContent, textBody, or textContent) is required'));
  } else {
    next();
  }
});

// Plugin de paginación
EmailTemplateSchema.plugin(mongoosePaginate);

const EmailTemplate = mongoose.model('EmailTemplate', EmailTemplateSchema);

module.exports = EmailTemplate;