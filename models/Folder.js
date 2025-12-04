const mongoose = require("mongoose");
const { Schema } = mongoose;

const PreFolderSchema = new Schema(
  {
    initialDatePreFolder: {
      type: Date,
      required: false,
    },
    finalDatePreFolder: {
      type: Date,
      required: false,
    },
    memberPreFolder: {
      type: String,
      required: false,
    },
    numberPreFolder: {
      type: String,
      required: false,
    },
    amountPreFolder: {
      type: Number,
      required: false,
    },
    statusPreFolder: {
      type: String,
      required: false,
    },
    descriptionPreFolder: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    // Índices para mejorar el rendimiento de las consultas
    indexes: [
      // Índice para búsqueda por userId (para el endpoint que está fallando)
      { userId: 1 },
      // Índice compuesto para ordenamiento por fecha de actualización
      { userId: 1, updatedAt: -1 },
      // Otros índices útiles
      { status: 1 },
      { groupId: 1 }
    ]
  }
);

const JudFolderSchema = new Schema(
  {
    initialDateJudFolder: {
      type: Date,
      required: false,
    },
    finalDateJudFolder: {
      type: Date,
      required: false,
    },
    //Número de expediente
    numberJudFolder: {
      type: String,
      required: false,
    },
    statusJudFolder: {
      type: String,
      required: false,
    },
    amountJudFolder: {
      type: String,
      required: false,
    },
    descriptionJudFolder: {
      type: String,
      required: false,
    },
    courtNumber: {
      type: String,
      required: false,
    },
    secretaryNumber: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    // Índices para mejorar el rendimiento de las consultas
    indexes: [
      // Índice para búsqueda por userId (para el endpoint que está fallando)
      { userId: 1 },
      // Índice compuesto para ordenamiento por fecha de actualización
      { userId: 1, updatedAt: -1 },
      // Otros índices útiles
      { status: 1 },
      { groupId: 1 }
    ]
  }
);

const ProcessStageSchema = new Schema(
  {
    // Nombre de la etapa (por ejemplo: "Intimación", "Presentación de demanda", etc.)
    name: {
      type: String,
      required: true
    },
    // Fase a la que pertenece esta etapa
    phase: {
      type: String,
      enum: ["prejudicial", "judicial"],
      required: true
    },
    // Fechas de la etapa
    startDate: {
      type: Date,
      default: null
    },
    endDate: {
      type: Date,
      default: null
    },
    // Si la etapa está activa actualmente
    isActive: {
      type: Boolean,
      default: false
    },
    // Quién está a cargo de esta etapa
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false
    },
    // Notas específicas de esta etapa
    notes: {
      type: String,
      default: ""
    },
    // Documentos asociados a esta etapa (IDs de documentos)
    documents: [{
      type: Schema.Types.ObjectId,
      ref: "Document"
    }],
    // Indicador de orden para mostrar las etapas en secuencia
    order: {
      type: Number,
      required: true
    }
  },
  {
    timestamps: true
  }
);

const FolderSchema = new Schema(
  {
    folderId: {
      type: String,
      required: false,
    },
    folderName: {
      type: String,
      required: true,
    },
    materia: {
      type: String,
      required: true,
    },
    orderStatus: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["Nueva", "En Proceso", "Cerrada", "Pendiente"],
      required: true,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    currentPhase: {
      type: String,
      enum: ["prejudicial", "judicial", null],
      default: null
    },
    // Etapa procesal actual dentro de la fase
    currentStage: {
      type: String,
      default: null
    },
    description: {
      type: String,
      required: false,
    },
    initialDateFolder: {
      type: Date,
      required: false,
    },
    finalDateFolder: {
      type: Date,
      required: false,
    },
    amount: {
      type: Number,
      required: false,
    },
    folderJuris: {
      item: {
        type: String,
        required: false,
        default: null,
      },
      label: {
        type: String,
        required: false,
        default: null,
      },
    },
    folderFuero: {
      type: String,
      required: false,
      default: null,
    },
    preFolder: {
      type: PreFolderSchema,
      required: false,
      default: null,
    },
    judFolder: {
      type: JudFolderSchema,
      required: false,
      default: null,
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
    situationFolder: {
      type: String,
    },
    source: {
      type: String,
      default: "manual",
      required: true
    },
    pjn: {
      type: Boolean,
      default: false,
    },
    mev: {
      type: Boolean,
      default: false,
    },
    // Nuevo campo para almacenar la referencia a la causa
    causaId: {
      type: Schema.Types.ObjectId,
      refPath: 'causaType',
      required: false
    },
    // Campo para especificar el tipo de causa referenciada (discriminador)
    causaType: {
      type: String,
      enum: ['CausasCivil', 'CausasTrabajo', 'CausasSegSocial', 'CausasComercial', 'MEV'],
      required: false
    },
    // Contadores para diferentes tipos de elementos
    calculatorsCount: {
      type: Number,
      default: 0,
      required: false
    },
    contactsCount: {
      type: Number,
      default: 0,
      required: false
    },
    agendaCount: {
      type: Number,
      default: 0,
      required: false
    },
    documentsCount: {
      type: Number,
      default: 0,
      required: false
    },
    tasksCount: {
      type: Number,
      default: 0,
      required: false
    },
    movementsCount: {
      type: Number,
      default: 0,
      required: false
    },
    // Campos de estado de la causa asociada
    causaVerified: {
      type: Boolean,
      default: false,
      required: false
    },
    causaIsValid: {
      type: Boolean,
      required: false
    },
    causaUpdateEnabled: {
      type: Boolean,
      default: false,
      required: false
    },
    causaAssociationStatus: {
      type: String,
      enum: ['pending', 'success', 'failed', 'not_attempted'],
      default: 'not_attempted',
      required: false
    },
    causaAssociationError: {
      type: String,
      required: false
    },
    causaLastSyncDate: {
      type: Date,
      required: false
    },
    lastMovementDate: {
      type: Date,
      default: null,
      required: false
    },
    overwrite: {
      type: Boolean
    },
    // Progreso del scraping/worker
    scrapingProgress: {
      isComplete: {
        type: Boolean,
        default: false,
        required: false
      },
      totalExpected: {
        type: Number,
        default: 0,
        required: false
      },
      totalProcessed: {
        type: Number,
        default: 0,
        required: false
      },
      status: {
        type: String,
        required: false
      }
    },
    // Historial de notificaciones enviadas
    notifications: [{
      date: {
        type: Date,
        default: Date.now
      },
      type: {
        type: String,
        enum: ['email', 'browser'],
        required: true
      },
      alertType: {
        type: String,
        enum: ['caducity', 'prescription'],
        required: true
      },
      success: {
        type: Boolean,
        default: true
      },
      details: {
        type: String
      }
    }]
  },
  {
    timestamps: true,
    // Índices para mejorar el rendimiento de las consultas
    indexes: [
      // Índice para búsqueda por userId (para el endpoint que está fallando)
      { userId: 1 },
      // Índice compuesto para ordenamiento por fecha de actualización
      { userId: 1, updatedAt: -1 },
      // Otros índices útiles
      { status: 1 },
      { groupId: 1 },
      // Índice para el nuevo campo causaId
      { causaId: 1 },
      // Índice compuesto para causaId y causaType
      { causaId: 1, causaType: 1 }
    ]
  }
);

module.exports = mongoose.model("Folder", FolderSchema);