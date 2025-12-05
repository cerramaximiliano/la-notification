/**
 * Script para crear folders de prueba para testear notificaciones de inactividad
 * Ejecutar con: node scripts/createTestFolders.js
 *
 * Crea folders que cumplan las condiciones de:
 * - Alerta de caducidad (fecha + caducityDays = hoy + daysInAdvance)
 * - Alerta de prescripción (fecha + prescriptionDays = hoy + daysInAdvance)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const moment = require('moment');

// Configuración por defecto (debe coincidir con las preferencias del usuario)
const DEFAULT_DAYS_IN_ADVANCE = 5;
const DEFAULT_CADUCITY_DAYS = 180;
const DEFAULT_PRESCRIPTION_DAYS = 730;

// Usuario para el que se crearán los folders
const TARGET_USER_ID = '647b7a2b7b6aad33b30b8de7';

// Materias de ejemplo
const MATERIAS = [
  'Civil',
  'Laboral',
  'Comercial',
  'Familia',
  'Penal',
  'Contencioso Administrativo',
  'Seguridad Social'
];

// Estados de ejemplo
const ORDER_STATUS = [
  'Actor',
  'Demandado',
  'Tercero'
];

// Fueros de ejemplo
const FUEROS = [
  'Civil y Comercial',
  'Laboral',
  'Federal',
  'Contencioso Administrativo'
];

/**
 * Genera un nombre de carpeta aleatorio
 */
function generateFolderName() {
  const apellidos = ['García', 'Rodríguez', 'López', 'Martínez', 'González', 'Pérez', 'Fernández', 'Sánchez'];
  const tipos = ['c/', 's/', 'y otros c/', 'y otro c/'];
  const acciones = ['daños y perjuicios', 'cobro de pesos', 'despido', 'accidente laboral', 'divorcio', 'sucesión', 'ejecución'];

  const apellido1 = apellidos[Math.floor(Math.random() * apellidos.length)];
  const apellido2 = apellidos[Math.floor(Math.random() * apellidos.length)];
  const tipo = tipos[Math.floor(Math.random() * tipos.length)];
  const accion = acciones[Math.floor(Math.random() * acciones.length)];

  return `${apellido1} ${tipo} ${apellido2} s/ ${accion}`;
}

/**
 * Genera un número de expediente aleatorio
 */
function generateExpedienteNumber() {
  const numero = Math.floor(Math.random() * 99999) + 1;
  const año = 2020 + Math.floor(Math.random() * 5);
  return `${numero}/${año}`;
}

/**
 * Crea un folder de prueba
 */
function createTestFolder(userId, lastActivityDate, type, index) {
  const materia = MATERIAS[Math.floor(Math.random() * MATERIAS.length)];
  const orderStatus = ORDER_STATUS[Math.floor(Math.random() * ORDER_STATUS.length)];
  const fuero = FUEROS[Math.floor(Math.random() * FUEROS.length)];

  return {
    folderName: generateFolderName(),
    materia: materia,
    orderStatus: orderStatus,
    status: ['Nueva', 'En Proceso', 'Pendiente'][Math.floor(Math.random() * 3)],
    archived: false,
    currentPhase: Math.random() > 0.5 ? 'judicial' : 'prejudicial',
    description: `Carpeta de prueba ${type} #${index} - Generada para testing de notificaciones`,
    initialDateFolder: moment(lastActivityDate).subtract(30, 'days').toDate(),
    lastMovementDate: lastActivityDate,
    amount: Math.floor(Math.random() * 10000000) + 100000,
    folderJuris: {
      item: 'CABA',
      label: 'Ciudad Autónoma de Buenos Aires'
    },
    folderFuero: fuero,
    userId: new mongoose.Types.ObjectId(userId),
    source: 'manual',
    pjn: Math.random() > 0.5,
    mev: false,
    judFolder: Math.random() > 0.5 ? {
      initialDateJudFolder: moment(lastActivityDate).subtract(15, 'days').toDate(),
      numberJudFolder: generateExpedienteNumber(),
      statusJudFolder: 'En trámite',
      courtNumber: String(Math.floor(Math.random() * 30) + 1),
      secretaryNumber: String(Math.floor(Math.random() * 3) + 1)
    } : null,
    calculatorsCount: 0,
    contactsCount: Math.floor(Math.random() * 5),
    agendaCount: Math.floor(Math.random() * 10),
    documentsCount: Math.floor(Math.random() * 20),
    tasksCount: Math.floor(Math.random() * 5),
    movementsCount: Math.floor(Math.random() * 50),
    notifications: [] // Sin notificaciones previas
  };
}

async function createTestFolders() {
  try {
    await mongoose.connect(process.env.URLDB);
    console.log('Conectado a MongoDB');

    const Folder = require('../models/Folder');

    // Verificar que el usuario existe
    const User = require('../models/User');
    const user = await User.findById(TARGET_USER_ID);

    if (!user) {
      console.error(`Usuario ${TARGET_USER_ID} no encontrado`);
      process.exit(1);
    }

    console.log(`Creando folders de prueba para el usuario: ${user.email}`);

    // Obtener configuración del usuario o usar valores por defecto
    const inactivitySettings = user.preferences?.notifications?.user?.inactivitySettings || {};
    const daysInAdvance = inactivitySettings.daysInAdvance || DEFAULT_DAYS_IN_ADVANCE;
    const caducityDays = inactivitySettings.caducityDays || DEFAULT_CADUCITY_DAYS;
    const prescriptionDays = inactivitySettings.prescriptionDays || DEFAULT_PRESCRIPTION_DAYS;

    console.log(`\nConfiguración del usuario:`);
    console.log(`- daysInAdvance: ${daysInAdvance}`);
    console.log(`- caducityDays: ${caducityDays}`);
    console.log(`- prescriptionDays: ${prescriptionDays}`);

    const today = moment.utc().startOf('day');

    // Calcular fechas para que cumplan las condiciones
    // Para caducidad: fecha + caducityDays = hoy + daysInAdvance
    // fecha = hoy + daysInAdvance - caducityDays
    const caducityTargetDate = today.clone().add(daysInAdvance, 'days').subtract(caducityDays, 'days');

    // Para prescripción: fecha + prescriptionDays = hoy + daysInAdvance
    // fecha = hoy + daysInAdvance - prescriptionDays
    const prescriptionTargetDate = today.clone().add(daysInAdvance, 'days').subtract(prescriptionDays, 'days');

    console.log(`\nFechas calculadas:`);
    console.log(`- Fecha para alerta de caducidad: ${caducityTargetDate.format('DD/MM/YYYY')} (hace ${today.diff(caducityTargetDate, 'days')} días)`);
    console.log(`- Fecha para alerta de prescripción: ${prescriptionTargetDate.format('DD/MM/YYYY')} (hace ${today.diff(prescriptionTargetDate, 'days')} días)`);

    const foldersToCreate = [];

    // Crear 3 folders que cumplan condición de CADUCIDAD
    console.log('\n--- Creando folders para alerta de CADUCIDAD ---');
    for (let i = 1; i <= 3; i++) {
      // Variamos ligeramente la fecha para simular diferentes escenarios
      const dateVariation = i - 2; // -1, 0, 1 días de variación
      const activityDate = caducityTargetDate.clone().add(dateVariation, 'days').toDate();

      const folder = createTestFolder(TARGET_USER_ID, activityDate, 'CADUCIDAD', i);
      folder.description = `[TEST CADUCIDAD #${i}] ${folder.description}`;
      foldersToCreate.push(folder);

      const daysUntilCaducity = moment(activityDate).add(caducityDays, 'days').diff(today, 'days');
      console.log(`  Folder ${i}: última actividad ${moment(activityDate).format('DD/MM/YYYY')} - Días hasta caducidad: ${daysUntilCaducity}`);
    }

    // Crear 3 folders que cumplan condición de PRESCRIPCIÓN
    console.log('\n--- Creando folders para alerta de PRESCRIPCIÓN ---');
    for (let i = 1; i <= 3; i++) {
      // Variamos ligeramente la fecha para simular diferentes escenarios
      const dateVariation = i - 2; // -1, 0, 1 días de variación
      const activityDate = prescriptionTargetDate.clone().add(dateVariation, 'days').toDate();

      const folder = createTestFolder(TARGET_USER_ID, activityDate, 'PRESCRIPCIÓN', i);
      folder.description = `[TEST PRESCRIPCIÓN #${i}] ${folder.description}`;
      foldersToCreate.push(folder);

      const daysUntilPrescription = moment(activityDate).add(prescriptionDays, 'days').diff(today, 'days');
      console.log(`  Folder ${i}: última actividad ${moment(activityDate).format('DD/MM/YYYY')} - Días hasta prescripción: ${daysUntilPrescription}`);
    }

    // Crear 2 folders que NO cumplan ninguna condición (muy recientes)
    console.log('\n--- Creando folders SIN alertas (recientes) ---');
    for (let i = 1; i <= 2; i++) {
      const activityDate = today.clone().subtract(i * 10, 'days').toDate(); // 10 y 20 días atrás

      const folder = createTestFolder(TARGET_USER_ID, activityDate, 'SIN_ALERTA', i);
      folder.description = `[TEST SIN ALERTA #${i}] ${folder.description}`;
      foldersToCreate.push(folder);

      console.log(`  Folder ${i}: última actividad ${moment(activityDate).format('DD/MM/YYYY')} - Sin alertas pendientes`);
    }

    // Insertar todos los folders
    console.log(`\n--- Insertando ${foldersToCreate.length} folders en la base de datos ---`);
    const result = await Folder.insertMany(foldersToCreate);

    console.log(`\n¡${result.length} folders creados exitosamente!`);

    // Mostrar IDs creados
    console.log('\nIDs de los folders creados:');
    result.forEach((folder, index) => {
      const type = folder.description.includes('CADUCIDAD') ? 'CADUCIDAD' :
                   folder.description.includes('PRESCRIPCIÓN') ? 'PRESCRIPCIÓN' : 'SIN_ALERTA';
      console.log(`  ${type}: ${folder._id} - ${folder.folderName}`);
    });

    console.log('\n--- Resumen ---');
    console.log(`Total folders creados: ${result.length}`);
    console.log(`- Para alerta de caducidad: 3`);
    console.log(`- Para alerta de prescripción: 3`);
    console.log(`- Sin alertas (control): 2`);

    console.log('\nEl cron de las 12:00 debería detectar y notificar los folders de caducidad y prescripción.');

    await mongoose.disconnect();
    console.log('\nDesconectado de MongoDB');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Función para eliminar los folders de prueba
async function cleanupTestFolders() {
  try {
    await mongoose.connect(process.env.URLDB);
    console.log('Conectado a MongoDB');

    const Folder = require('../models/Folder');

    const result = await Folder.deleteMany({
      userId: new mongoose.Types.ObjectId(TARGET_USER_ID),
      description: { $regex: /^\[TEST/ }
    });

    console.log(`${result.deletedCount} folders de prueba eliminados`);

    await mongoose.disconnect();
    console.log('Desconectado de MongoDB');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Ejecutar según el argumento
const arg = process.argv[2];

if (arg === '--cleanup' || arg === '-c') {
  console.log('Eliminando folders de prueba...\n');
  cleanupTestFolders();
} else {
  console.log('Creando folders de prueba...\n');
  createTestFolders();
}
