/**
 * Script de Coordinación de Notificaciones Judiciales
 *
 * Este script busca causas con movimientos del día actual y crea los documentos
 * JudicialMovement faltantes para que puedan ser notificados.
 *
 * Uso:
 *   node scripts/coordinateJudicialNotifications.js [opciones]
 *
 * Opciones:
 *   --dry-run, -d     Solo mostrar lo que se haría sin crear documentos
 *   --date YYYY-MM-DD Usar una fecha específica en lugar de hoy
 *   --verbose, -v     Mostrar información detallada
 *   --help, -h        Mostrar ayuda
 *
 * Ejemplos:
 *   node scripts/coordinateJudicialNotifications.js
 *   node scripts/coordinateJudicialNotifications.js --dry-run
 *   node scripts/coordinateJudicialNotifications.js --date 2026-01-20
 *   node scripts/coordinateJudicialNotifications.js --dry-run --verbose
 */

require('dotenv').config();
const mongoose = require('mongoose');
const moment = require('moment-timezone');

// Configuración
const TIMEZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_NOTIFICATION_HOUR = 19; // 19:00 horas

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60));
}

// Parsear argumentos de línea de comandos
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    verbose: false,
    date: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--date' && args[i + 1]) {
      options.date = args[i + 1];
      i++;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Uso: node scripts/coordinateJudicialNotifications.js [opciones]

Este script busca causas con movimientos del día actual y crea los documentos
JudicialMovement faltantes para que puedan ser notificados.

Opciones:
  --dry-run, -d     Solo mostrar lo que se haría sin crear documentos
  --date YYYY-MM-DD Usar una fecha específica en lugar de hoy
  --verbose, -v     Mostrar información detallada
  --help, -h        Mostrar esta ayuda

Ejemplos:
  node scripts/coordinateJudicialNotifications.js
  node scripts/coordinateJudicialNotifications.js --dry-run
  node scripts/coordinateJudicialNotifications.js --date 2026-01-20
  node scripts/coordinateJudicialNotifications.js --dry-run --verbose
`);
}

/**
 * Mapeo de nombres de colección para cada tipo de causa
 * Las colecciones están en la misma base de datos
 */
const CAUSA_COLLECTIONS = {
  'CausasCivil': 'causas-civil',
  'CausasComercial': 'causas-comercial',
  'CausasSegSoc': 'causas-segsocial',
  'CausasTrabajo': 'causas-trabajo',
  'CausasCAF': 'causas_caf',
  'CausasCCF': 'causas_ccf',
  'CausasCNE': 'causas_cne',
  'CausasCPE': 'causas_cpe',
  'CausasCFP': 'causas_cfp',
  'CausasCCC': 'causas_ccc',
  'CausasCSJ': 'causas_csj'
};

/**
 * Mapea el tipo de causa (usado en Folder.causaType) al nombre de colección
 */
const causaTypeToCollection = {
  'CausasCivil': 'causas-civil',
  'CausasComercial': 'causas-comercial',
  'CausasSegSocial': 'causas-segsocial',
  'CausasTrabajo': 'causas-trabajo'
};

/**
 * Busca causas con movimientos en la fecha especificada
 * Usa directamente la conexión mongoose para acceder a las colecciones
 *
 * NOTA: Las fechas en las causas están almacenadas en UTC medianoche (00:00:00.000Z)
 * Por lo tanto buscamos exactamente esa fecha UTC
 */
async function findCausasWithMovements(targetDate, verbose) {
  // Las fechas en las causas están en UTC medianoche, así que buscamos en ese formato
  const targetDateUTC = moment.utc(targetDate).startOf('day').toDate();
  const nextDayUTC = moment.utc(targetDate).add(1, 'day').startOf('day').toDate();

  if (verbose) {
    log(`\nBuscando causas con fechaUltimoMovimiento entre:`, 'cyan');
    log(`  Inicio (UTC): ${targetDateUTC.toISOString()}`, 'cyan');
    log(`  Fin (UTC): ${nextDayUTC.toISOString()}`, 'cyan');
  }

  const allCausas = [];
  const db = mongoose.connection.db;

  for (const [modelName, collectionName] of Object.entries(CAUSA_COLLECTIONS)) {
    try {
      const collection = db.collection(collectionName);
      const causas = await collection.find({
        fechaUltimoMovimiento: {
          $gte: targetDateUTC,
          $lt: nextDayUTC
        }
      }).toArray();

      if (causas.length > 0) {
        log(`  ${modelName}: ${causas.length} causas encontradas`, 'green');
        causas.forEach(causa => {
          causa._modelName = modelName;
          causa._collectionName = collectionName;
        });
        allCausas.push(...causas);
      } else if (verbose) {
        log(`  ${modelName}: 0 causas`, 'yellow');
      }
    } catch (error) {
      log(`  Error en ${modelName}: ${error.message}`, 'red');
    }
  }

  return allCausas;
}

/**
 * Filtra los movimientos de una causa que coincidan con la fecha objetivo
 * Las fechas de movimientos están en UTC (ej: "2026-01-20T00:00:00.000Z")
 */
function filterMovementsByDate(causa, targetDate) {
  if (!causa.movimiento || !Array.isArray(causa.movimiento)) {
    return [];
  }

  // Usar UTC para comparar ya que las fechas están almacenadas en UTC
  const targetDateStr = moment.utc(targetDate).format('YYYY-MM-DD');

  return causa.movimiento.filter(mov => {
    if (!mov.fecha) return false;
    // Las fechas de movimientos están en UTC
    const movDateStr = moment.utc(mov.fecha).format('YYYY-MM-DD');
    return movDateStr === targetDateStr;
  });
}

/**
 * Obtiene los usuarios vinculados a una causa a través de los Folders
 */
async function getUsersForCausa(Folder, causaId) {
  const folders = await Folder.find({ causaId }).select('userId').lean();

  // Obtener userIds únicos
  const userIds = [...new Set(folders.map(f => f.userId?.toString()).filter(Boolean))];

  return userIds;
}

/**
 * Función principal del script
 */
async function coordinateJudicialNotifications(options) {
  const { dryRun, verbose, date } = options;

  // Determinar la fecha objetivo
  const targetDate = date
    ? moment.tz(date, 'YYYY-MM-DD', TIMEZONE)
    : moment.tz(TIMEZONE);

  logSection(`COORDINACIÓN DE NOTIFICACIONES JUDICIALES`);
  log(`Fecha objetivo: ${targetDate.format('DD/MM/YYYY')} (${targetDate.format('YYYY-MM-DD')})`, 'cyan');
  if (dryRun) {
    log(`MODO DRY-RUN: No se crearán documentos`, 'yellow');
  }

  try {
    // Conectar a MongoDB
    log(`\nConectando a MongoDB...`, 'blue');
    await mongoose.connect(process.env.URLDB);
    log(`Conectado exitosamente`, 'green');

    // Cargar modelos locales
    const Folder = require('../models/Folder');
    const JudicialMovement = require('../models/JudicialMovement');

    // Estadísticas
    const stats = {
      causasEncontradas: 0,
      movimientosDelDia: 0,
      usuariosVinculados: 0,
      notificacionesExistentes: 0,
      notificacionesCreadas: 0,
      errores: []
    };

    // Buscar causas con movimientos del día
    logSection('BUSCANDO CAUSAS');
    const causas = await findCausasWithMovements(targetDate, verbose);
    stats.causasEncontradas = causas.length;

    if (causas.length === 0) {
      log(`\nNo se encontraron causas con movimientos para la fecha ${targetDate.format('DD/MM/YYYY')}`, 'yellow');
      await mongoose.disconnect();
      return stats;
    }

    log(`\nTotal de causas encontradas: ${causas.length}`, 'green');

    // Calcular hora de notificación
    const notifyAt = moment.tz(TIMEZONE)
      .hour(DEFAULT_NOTIFICATION_HOUR)
      .minute(0)
      .second(0)
      .toDate();

    // Si la hora ya pasó, usar la hora actual
    const now = new Date();
    const finalNotifyAt = notifyAt < now ? now : notifyAt;

    logSection('PROCESANDO CAUSAS');

    for (const causa of causas) {
      const causaInfo = `${causa.number}/${causa.year} (${causa.fuero})`;

      if (verbose) {
        log(`\n--- Procesando causa: ${causaInfo} ---`, 'magenta');
        log(`  Carátula: ${causa.caratula?.substring(0, 50)}...`);
      }

      // Filtrar movimientos del día
      const movimientosDelDia = filterMovementsByDate(causa, targetDate);

      if (movimientosDelDia.length === 0) {
        if (verbose) {
          log(`  Sin movimientos del día específico`, 'yellow');
        }
        continue;
      }

      stats.movimientosDelDia += movimientosDelDia.length;

      if (verbose) {
        log(`  Movimientos del día: ${movimientosDelDia.length}`, 'cyan');
        movimientosDelDia.forEach((mov, i) => {
          log(`    ${i + 1}. ${mov.tipo}: ${mov.detalle?.substring(0, 40)}...`);
        });
      }

      // Obtener usuarios vinculados
      const userIds = await getUsersForCausa(Folder, causa._id);

      if (userIds.length === 0) {
        if (verbose) {
          log(`  Sin usuarios vinculados a esta causa`, 'yellow');
        }
        continue;
      }

      stats.usuariosVinculados += userIds.length;

      if (verbose) {
        log(`  Usuarios vinculados: ${userIds.length}`, 'cyan');
      }

      // Procesar cada combinación de usuario y movimiento
      for (const userId of userIds) {
        for (const movimiento of movimientosDelDia) {
          try {
            // Generar uniqueKey
            const uniqueKey = JudicialMovement.generateUniqueKey(
              userId,
              causa._id.toString(),
              movimiento.fecha,
              movimiento.tipo,
              movimiento.detalle
            );

            // Verificar si ya existe
            const existing = await JudicialMovement.findOne({ uniqueKey });

            if (existing) {
              stats.notificacionesExistentes++;
              if (verbose) {
                log(`    [EXISTE] Usuario ${userId} - ${movimiento.tipo}`, 'yellow');
              }
              continue;
            }

            // Crear documento de notificación
            if (!dryRun) {
              await JudicialMovement.create({
                userId: new mongoose.Types.ObjectId(userId),
                expediente: {
                  id: causa._id.toString(),
                  number: causa.number,
                  year: causa.year,
                  fuero: causa.fuero,
                  caratula: causa.caratula,
                  objeto: causa.objeto
                },
                movimiento: {
                  fecha: new Date(movimiento.fecha),
                  tipo: movimiento.tipo,
                  detalle: movimiento.detalle,
                  url: movimiento.url
                },
                notificationSettings: {
                  notifyAt: finalNotifyAt,
                  channels: ['email', 'browser']
                },
                uniqueKey,
                notificationStatus: 'pending'
              });
            }

            stats.notificacionesCreadas++;
            if (verbose) {
              log(`    [${dryRun ? 'CREAR' : 'CREADO'}] Usuario ${userId} - ${movimiento.tipo}`, 'green');
            }

          } catch (error) {
            if (error.code === 11000) {
              // Duplicado - ya existe
              stats.notificacionesExistentes++;
              if (verbose) {
                log(`    [DUPLICADO] Usuario ${userId} - ${movimiento.tipo}`, 'yellow');
              }
            } else {
              stats.errores.push({
                causa: causaInfo,
                userId,
                movimiento: movimiento.tipo,
                error: error.message
              });
              log(`    [ERROR] ${error.message}`, 'red');
            }
          }
        }
      }
    }

    // Mostrar resumen
    logSection('RESUMEN');
    log(`Fecha procesada: ${targetDate.format('DD/MM/YYYY')}`, 'cyan');
    log(`Hora de notificación: ${moment(finalNotifyAt).tz(TIMEZONE).format('HH:mm')}`, 'cyan');
    console.log('');
    log(`Causas encontradas:           ${stats.causasEncontradas}`, 'blue');
    log(`Movimientos del día:          ${stats.movimientosDelDia}`, 'blue');
    log(`Usuarios vinculados:          ${stats.usuariosVinculados}`, 'blue');
    log(`Notificaciones ya existentes: ${stats.notificacionesExistentes}`, 'yellow');
    log(`Notificaciones ${dryRun ? 'a crear' : 'creadas'}:       ${stats.notificacionesCreadas}`, 'green');

    if (stats.errores.length > 0) {
      log(`Errores:                      ${stats.errores.length}`, 'red');
      if (verbose) {
        stats.errores.forEach(err => {
          log(`  - ${err.causa}: ${err.error}`, 'red');
        });
      }
    }

    if (dryRun && stats.notificacionesCreadas > 0) {
      console.log('');
      log(`Para crear las notificaciones, ejecuta sin --dry-run`, 'yellow');
    }

    await mongoose.disconnect();
    log(`\nDesconectado de MongoDB`, 'blue');

    return stats;

  } catch (error) {
    log(`\nError fatal: ${error.message}`, 'red');
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Ejecutar script
const options = parseArgs();

if (options.help) {
  showHelp();
  process.exit(0);
}

coordinateJudicialNotifications(options)
  .then(stats => {
    console.log('\n' + '='.repeat(60));
    log('Script finalizado exitosamente', 'green');
    console.log('='.repeat(60) + '\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
