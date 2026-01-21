/**
 * Procesa datos para informes administrativos
 */

/**
 * Procesa datos para el informe de notificaciones de calendario
 * @param {Object} summary - Resumen de notificaciones procesadas
 * @returns {Object} - Variables procesadas para el template
 */
function processCalendarReportData(summary) {
  return {
    usersProcessed: summary.usersProcessed || 0,
    usersNotified: summary.usersNotified || 0,
    emailNotificationsSent: summary.emailNotificationsSent || 0,
    browserAlertsSent: summary.browserAlertsSent || 0,
    totalEventNotifications: summary.totalEventNotifications || 0,
    reportDate: new Date().toLocaleString('es-ES')
  };
}

/**
 * Procesa datos para el informe de notificaciones de tareas
 * @param {Object} summary - Resumen de notificaciones procesadas
 * @returns {Object} - Variables procesadas para el template
 */
function processTaskReportData(summary) {
  return {
    usersProcessed: summary.usersProcessed || 0,
    usersNotified: summary.usersNotified || 0,
    emailNotificationsSent: summary.emailNotificationsSent || 0,
    browserAlertsSent: summary.browserAlertsSent || 0,
    totalTaskNotifications: summary.totalTaskNotifications || 0,
    reportDate: new Date().toLocaleString('es-ES')
  };
}

/**
 * Procesa datos para el informe de notificaciones de movimientos
 * @param {Object} summary - Resumen de notificaciones procesadas
 * @returns {Object} - Variables procesadas para el template
 */
function processMovementReportData(summary) {
  return {
    usersProcessed: summary.usersProcessed || 0,
    usersNotified: summary.usersNotified || 0,
    emailNotificationsSent: summary.emailNotificationsSent || 0,
    browserAlertsSent: summary.browserAlertsSent || 0,
    totalMovementNotifications: summary.totalMovementNotifications || 0,
    reportDate: new Date().toLocaleString('es-ES')
  };
}

/**
 * Procesa datos para el informe de notificaciones de inactividad de carpetas
 * @param {Object} summary - Resumen de notificaciones procesadas
 * @returns {Object} - Variables procesadas para el template
 */
function processFolderInactivityReportData(summary) {
  return {
    usersProcessed: summary.usersProcessed || 0,
    usersNotified: summary.usersNotified || 0,
    caducityNotifications: summary.caducityNotificationsSent || 0,
    prescriptionNotifications: summary.prescriptionNotificationsSent || 0,
    totalNotifications: summary.totalNotifications || 0,
    timestamp: new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
  };
}

/**
 * Procesa datos para el informe de notificaciones de movimientos judiciales
 * @param {Object} summary - Resumen de notificaciones procesadas
 * @returns {Object} - Variables procesadas para el template
 */
function processJudicialMovementReportData(summary) {
  const coordination = summary.coordination || {};
  const notification = summary.notification || {};

  // Determinar el estado general del proceso
  const hasErrors = coordination.errores > 0 || notification.failed > 0;
  const hasWarnings = coordination.causasEncontradas > 0 && coordination.notificacionesCreadas === 0 && coordination.notificacionesExistentes === 0;

  let statusIcon = '✅';
  let statusText = 'Completado exitosamente';
  let statusColor = '#10b981'; // green

  if (hasErrors) {
    statusIcon = '❌';
    statusText = 'Completado con errores';
    statusColor = '#ef4444'; // red
  } else if (hasWarnings) {
    statusIcon = '⚠️';
    statusText = 'Completado con advertencias';
    statusColor = '#f59e0b'; // amber
  }

  return {
    // Estado general
    statusIcon,
    statusText,
    statusColor,

    // Coordinación
    causasEncontradas: coordination.causasEncontradas || 0,
    movimientosDelDia: coordination.movimientosDelDia || 0,
    usuariosVinculados: coordination.usuariosVinculados || 0,
    notificacionesExistentes: coordination.notificacionesExistentes || 0,
    notificacionesCreadas: coordination.notificacionesCreadas || 0,
    erroresCoordinacion: coordination.errores || 0,

    // Notificación
    usuariosPendientes: notification.usuariosPendientes || 0,
    notificacionesEnviadas: notification.enviadas || 0,
    usuariosExitosos: notification.exitosos || 0,
    usuariosFallidos: notification.fallidos || 0,

    // Totales
    totalDocumentosCreados: coordination.notificacionesCreadas || 0,
    totalNotificacionesEnviadas: notification.enviadas || 0,
    totalErrores: (coordination.errores || 0) + (notification.fallidos || 0),

    // Metadata
    timestamp: new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
    fechaProcesada: summary.fechaProcesada || new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
  };
}

/**
 * Procesa datos para el informe de limpieza de logs
 * @param {Object} data - Datos de la limpieza de logs
 * @returns {Object} - Variables procesadas para el template
 */
function processLogCleanupReportData(data) {
  const { summary, fileStats, systemInfo } = data;
  
  // Generar HTML de la tabla de archivos
  let filesTableHtml = '';
  if (fileStats) {
    Object.entries(fileStats).forEach(([fileName, stats]) => {
      filesTableHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px; color: #64748b; font-size: 13px;">${fileName}</td>
          <td style="padding: 10px; text-align: right; color: #1e293b; font-size: 13px;">${stats.size} MB</td>
        </tr>`;
    });
  }
  
  return {
    filesProcessed: summary.filesProcessed || 0,
    filesCleared: summary.filesCleared || 0,
    errors: summary.errors || 0,
    filesTableHtml: filesTableHtml || '<tr><td colspan="2" style="padding: 10px; text-align: center; color: #94a3b8;">No hay información de archivos</td></tr>',
    diskUsageBefore: systemInfo?.diskUsageBefore?.percentage || 'N/A',
    diskUsageAfter: systemInfo?.diskUsageAfter?.percentage || 'N/A',
    spaceSaved: systemInfo?.spaceSaved || '0 MB',
    memoryUsage: systemInfo?.memoryUsage?.heapUsed || 'N/A',
    dbStatus: systemInfo?.dbStatus || 'Desconocido',
    uptime: systemInfo?.uptime || 'N/A',
    reportDate: new Date().toLocaleString('es-ES')
  };
}

module.exports = {
  processCalendarReportData,
  processTaskReportData,
  processMovementReportData,
  processFolderInactivityReportData,
  processJudicialMovementReportData,
  processLogCleanupReportData
};