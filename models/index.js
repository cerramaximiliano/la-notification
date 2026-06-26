/**
 * Archivo central para cargar todos los modelos
 * Esto asegura que las referencias entre modelos funcionen correctamente
 */

// Cargar modelos en orden de dependencias
const User = require('./User');
const Event = require('./Event');
const Task = require('./Task');
const Movement = require('./Movement');
const Alert = require('./Alert');
const NotificationLog = require('./NotificationLog');
const JudicialMovement = require('./JudicialMovement');
const JudicialCedula = require('./JudicialCedula');
const EmailTemplate = require('./EmailTemplate');
const Folder = require('./Folder');

// Exportar todos los modelos
module.exports = {
  User,
  Event,
  Task,
  Movement,
  Alert,
  NotificationLog,
  JudicialMovement,
  JudicialCedula,
  EmailTemplate,
  Folder
};