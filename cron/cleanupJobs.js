/**
 * Trabajos de limpieza y mantenimiento del sistema
 * Incluye limpieza de logs del filesystem, MongoDB y PM2
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const logger = require('../config/logger');
const NotificationLog = require('../models/NotificationLog');
const Alert = require('../models/Alert');
const JudicialMovement = require('../models/JudicialMovement');
const moment = require('moment');

/**
 * Configuración de retención de logs (en días)
 */
const LOG_RETENTION_CONFIG = {
  notificationLogs: parseInt(process.env.NOTIFICATION_LOG_RETENTION_DAYS || '30'),
  alerts: parseInt(process.env.ALERT_LOG_RETENTION_DAYS || '30'),
  judicialMovements: parseInt(process.env.JUDICIAL_MOVEMENT_RETENTION_DAYS || '60'),
  fileSystemLogs: parseInt(process.env.FILE_LOG_RETENTION_DAYS || '7'),
  pm2Logs: parseInt(process.env.PM2_LOG_RETENTION_DAYS || '7')
};

/**
 * Limpia logs antiguos de la base de datos MongoDB
 */
async function cleanMongoDBLogs() {
  const results = {
    notificationLogs: 0,
    alerts: 0,
    judicialMovements: 0,
    errors: []
  };

  try {
    // Limpiar NotificationLogs antiguos
    const notificationCutoff = moment().subtract(LOG_RETENTION_CONFIG.notificationLogs, 'days').toDate();
    const notificationResult = await NotificationLog.deleteMany({
      sentAt: { $lt: notificationCutoff }
    });
    results.notificationLogs = notificationResult.deletedCount;
    logger.info(`Eliminados ${results.notificationLogs} logs de notificaciones antiguos (más de ${LOG_RETENTION_CONFIG.notificationLogs} días)`);

    // Limpiar Alertas entregadas antiguos
    const alertCutoff = moment().subtract(LOG_RETENTION_CONFIG.alerts, 'days').toDate();
    const alertResult = await Alert.deleteMany({
      status: 'delivered',
      deliveredAt: { $lt: alertCutoff }
    });
    results.alerts = alertResult.deletedCount;
    logger.info(`Eliminadas ${results.alerts} alertas entregadas antiguas (más de ${LOG_RETENTION_CONFIG.alerts} días)`);

    // Limpiar movimientos judiciales procesados antiguos
    const judicialCutoff = moment().subtract(LOG_RETENTION_CONFIG.judicialMovements, 'days').toDate();
    const judicialResult = await JudicialMovement.deleteMany({
      notificationStatus: 'sent',
      updatedAt: { $lt: judicialCutoff }
    });
    results.judicialMovements = judicialResult.deletedCount;
    logger.info(`Eliminados ${results.judicialMovements} movimientos judiciales procesados (más de ${LOG_RETENTION_CONFIG.judicialMovements} días)`);

  } catch (error) {
    logger.error(`Error limpiando logs de MongoDB: ${error.message}`);
    results.errors.push(error.message);
  }

  return results;
}

/**
 * Limpia archivos de log del sistema de archivos
 */
async function cleanFileSystemLogs() {
  const logDir = path.join(__dirname, '../logs');
  const results = {
    filesProcessed: 0,
    filesCleared: 0,
    filesDeleted: 0,
    totalSizeBefore: 0,
    totalSizeAfter: 0,
    errors: []
  };

  try {
    if (!fs.existsSync(logDir)) {
      logger.warn(`Directorio de logs no existe: ${logDir}`);
      return results;
    }

    const files = fs.readdirSync(logDir);
    const cutoffDate = moment().subtract(LOG_RETENTION_CONFIG.fileSystemLogs, 'days').toDate();

    for (const file of files) {
      const filePath = path.join(logDir, file);
      
      try {
        const stats = fs.statSync(filePath);
        results.filesProcessed++;
        results.totalSizeBefore += stats.size;

        // Si el archivo es antiguo, eliminarlo
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          logger.info(`Archivo de log eliminado (antiguo): ${file}`);
          results.filesDeleted++;
        } 
        // Si es un archivo de log actual y es muy grande (>100MB), truncarlo
        else if (stats.size > 100 * 1024 * 1024) {
          // Guardar las últimas 1000 líneas
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            const lastLines = lines.slice(-1000).join('\n');
            fs.writeFileSync(filePath, lastLines);
            logger.info(`Archivo de log truncado (muy grande): ${file}`);
            results.filesCleared++;
          } catch (err) {
            // Si falla, simplemente vaciar el archivo
            fs.writeFileSync(filePath, '');
            logger.info(`Archivo de log vaciado: ${file}`);
            results.filesCleared++;
          }
        }

        // Obtener tamaño después
        if (fs.existsSync(filePath)) {
          const newStats = fs.statSync(filePath);
          results.totalSizeAfter += newStats.size;
        }

      } catch (error) {
        logger.error(`Error procesando archivo ${file}: ${error.message}`);
        results.errors.push(`${file}: ${error.message}`);
      }
    }

  } catch (error) {
    logger.error(`Error limpiando logs del filesystem: ${error.message}`);
    results.errors.push(error.message);
  }

  return results;
}

/**
 * Limpia logs de PM2
 */
async function cleanPM2Logs() {
  const results = {
    success: false,
    message: '',
    sizeBefore: 0,
    sizeAfter: 0
  };

  try {
    // Obtener tamaño actual de logs de PM2
    const pm2LogDir = path.join(process.env.HOME || '/home/mcerra', '.pm2/logs');
    
    if (fs.existsSync(pm2LogDir)) {
      // Calcular tamaño antes
      const files = fs.readdirSync(pm2LogDir);
      for (const file of files) {
        const filePath = path.join(pm2LogDir, file);
        const stats = fs.statSync(filePath);
        results.sizeBefore += stats.size;
      }

      // Ejecutar comando de limpieza de PM2
      execSync('pm2 flush', { encoding: 'utf-8' });
      logger.info('Logs de PM2 limpiados con pm2 flush');

      // Calcular tamaño después
      results.sizeAfter = 0;
      const filesAfter = fs.readdirSync(pm2LogDir);
      for (const file of filesAfter) {
        const filePath = path.join(pm2LogDir, file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          results.sizeAfter += stats.size;
        }
      }

      results.success = true;
      results.message = 'Logs de PM2 limpiados exitosamente';
    } else {
      results.message = 'Directorio de logs de PM2 no encontrado';
    }

  } catch (error) {
    logger.error(`Error limpiando logs de PM2: ${error.message}`);
    results.message = error.message;
  }

  return results;
}

/**
 * Obtiene información del uso del disco
 */
async function getDiskUsageInfo() {
  try {
    const output = execSync('df -k / | tail -1').toString().trim();
    const parts = output.split(/\s+/);

    const total = parseInt(parts[1], 10) * 1024;
    const used = parseInt(parts[2], 10) * 1024;
    const available = parseInt(parts[3], 10) * 1024;
    const usedPercentage = parts[4].replace('%', '');

    return { total, used, available, usedPercentage };
  } catch (error) {
    logger.error(`Error obteniendo información del disco: ${error.message}`);
    return { total: 0, used: 0, available: 0, usedPercentage: '0' };
  }
}

/**
 * Trabajo principal de limpieza completa
 */
async function comprehensiveCleanupJob() {
  logger.info('========================================');
  logger.info('Iniciando limpieza completa del sistema');
  logger.info('========================================');

  const startTime = Date.now();
  const diskBefore = await getDiskUsageInfo();

  const results = {
    timestamp: new Date(),
    duration: 0,
    filesystem: {},
    mongodb: {},
    pm2: {},
    diskSpace: {
      before: diskBefore,
      after: {}
    },
    summary: {
      totalDeleted: 0,
      spaceSaved: 0,
      errors: []
    }
  };

  try {
    // 1. Limpiar logs del filesystem
    logger.info('Paso 1/3: Limpiando logs del filesystem...');
    results.filesystem = await cleanFileSystemLogs();
    
    // 2. Limpiar logs de MongoDB
    logger.info('Paso 2/3: Limpiando logs de MongoDB...');
    results.mongodb = await cleanMongoDBLogs();
    
    // 3. Limpiar logs de PM2
    logger.info('Paso 3/3: Limpiando logs de PM2...');
    results.pm2 = await cleanPM2Logs();

    // Obtener información del disco después
    const diskAfter = await getDiskUsageInfo();
    results.diskSpace.after = diskAfter;

    // Calcular resumen
    results.summary.totalDeleted = 
      (results.filesystem.filesDeleted || 0) + 
      (results.filesystem.filesCleared || 0) +
      results.mongodb.notificationLogs +
      results.mongodb.alerts +
      results.mongodb.judicialMovements;

    results.summary.spaceSaved = diskBefore.used - diskAfter.used;
    results.duration = Date.now() - startTime;

    // Recopilar todos los errores
    results.summary.errors = [
      ...results.filesystem.errors,
      ...results.mongodb.errors
    ];

    logger.info('========================================');
    logger.info('Limpieza completa finalizada');
    logger.info(`Duración: ${results.duration}ms`);
    logger.info(`Total elementos eliminados: ${results.summary.totalDeleted}`);
    logger.info(`Espacio liberado: ${(results.summary.spaceSaved / 1024 / 1024).toFixed(2)} MB`);
    logger.info(`Errores encontrados: ${results.summary.errors.length}`);
    logger.info('========================================');

    // Enviar reporte por email si está configurado
    if (process.env.ADMIN_EMAIL && process.env.SEND_CLEANUP_REPORTS === 'true') {
      await sendCleanupReport(results);
    }

  } catch (error) {
    logger.error(`Error crítico en limpieza completa: ${error.message}`);
    results.summary.errors.push(error.message);
  }

  return results;
}

/**
 * Envía reporte de limpieza al administrador
 */
async function sendCleanupReport(results) {
  try {
    const { sendEmail } = require('../services/email');
    const adminEmail = process.env.ADMIN_EMAIL;

    const subject = `[Sistema de Notificaciones] Reporte de Limpieza - ${moment().format('DD/MM/YYYY')}`;
    
    const html = `
      <h2>Reporte de Limpieza del Sistema</h2>
      <p><strong>Fecha:</strong> ${moment(results.timestamp).format('DD/MM/YYYY HH:mm:ss')}</p>
      <p><strong>Duración:</strong> ${results.duration}ms</p>
      
      <h3>Resumen</h3>
      <ul>
        <li>Total elementos eliminados: ${results.summary.totalDeleted}</li>
        <li>Espacio liberado: ${(results.summary.spaceSaved / 1024 / 1024).toFixed(2)} MB</li>
        <li>Errores: ${results.summary.errors.length}</li>
      </ul>
      
      <h3>Filesystem</h3>
      <ul>
        <li>Archivos procesados: ${results.filesystem.filesProcessed}</li>
        <li>Archivos eliminados: ${results.filesystem.filesDeleted}</li>
        <li>Archivos truncados: ${results.filesystem.filesCleared}</li>
      </ul>
      
      <h3>MongoDB</h3>
      <ul>
        <li>Logs de notificaciones: ${results.mongodb.notificationLogs}</li>
        <li>Alertas antiguas: ${results.mongodb.alerts}</li>
        <li>Movimientos judiciales: ${results.mongodb.judicialMovements}</li>
      </ul>
      
      <h3>PM2</h3>
      <p>${results.pm2.message}</p>
      
      <h3>Espacio en Disco</h3>
      <ul>
        <li>Antes: ${results.diskSpace.before.usedPercentage}% usado</li>
        <li>Después: ${results.diskSpace.after.usedPercentage}% usado</li>
      </ul>
      
      ${results.summary.errors.length > 0 ? `
        <h3>Errores</h3>
        <ul>
          ${results.summary.errors.map(err => `<li>${err}</li>`).join('')}
        </ul>
      ` : ''}
    `;

    await sendEmail(adminEmail, subject, html, html);
    logger.info(`Reporte de limpieza enviado a ${adminEmail}`);
  } catch (error) {
    logger.error(`Error enviando reporte de limpieza: ${error.message}`);
  }
}

module.exports = {
  comprehensiveCleanupJob,
  cleanMongoDBLogs,
  cleanFileSystemLogs,
  cleanPM2Logs,
  LOG_RETENTION_CONFIG
};