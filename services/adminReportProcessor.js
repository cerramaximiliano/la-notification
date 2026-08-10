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
  processLogCleanupReportData,
  buildConfigSummarySection,
  buildSourceDistributionSection
};

/**
 * Sección "Origen de las notificaciones" para el reporte del admin: gráfico
 * de torta (imagen renderizada por QuickChart — los emails no ejecutan JS)
 * + leyenda en tabla con conteos y porcentajes como fallback si el cliente
 * bloquea imágenes.
 *
 * @param {Object|null} data - { movimientos: [{_id: source, count}], cedulas: number }
 * @returns {{html: string, text: string}}
 */
function buildSourceDistributionSection(data) {
  const SOURCE_META = {
    pjn: { label: 'PJN', color: '#3A7BFF' },
    scba: { label: 'SCBA', color: '#8B5CF6' },
    eje: { label: 'EJE (CABA)', color: '#22C55E' },
    mev: { label: 'MEV', color: '#F59E0B' }
  };
  const CEDULAS_META = { label: 'Cédulas (PJN)', color: '#64748B' };

  const slices = [];
  if (data && Array.isArray(data.movimientos)) {
    for (const row of data.movimientos) {
      const key = row._id || 'pjn'; // el coordinador no setea source → default pjn
      const meta = SOURCE_META[key] || { label: String(key).toUpperCase(), color: '#94A3B8' };
      const existing = slices.find(s => s.label === meta.label);
      if (existing) {
        existing.count += row.count || 0;
      } else {
        slices.push({ label: meta.label, color: meta.color, count: row.count || 0 });
      }
    }
  }
  if (data && data.cedulas > 0) {
    slices.push({ label: CEDULAS_META.label, color: CEDULAS_META.color, count: data.cedulas });
  }

  const total = slices.reduce((acc, s) => acc + s.count, 0);

  if (total === 0) {
    return {
      html: `
  <div style="margin-top:24px;padding:16px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
    <h3 style="margin:0 0 4px 0;font-size:14px;color:#111827;">Origen de las notificaciones (hoy)</h3>
    <p style="margin:0;font-size:12px;color:#6b7280;">Todavía no se enviaron notificaciones judiciales hoy.</p>
  </div>`,
      text: '\n\nORIGEN DE LAS NOTIFICACIONES (HOY)\nTodavía no se enviaron notificaciones judiciales hoy.\n'
    };
  }

  slices.sort((a, b) => b.count - a.count);
  const pct = (count) => Math.round((count / total) * 1000) / 10;

  // Imagen del gráfico de torta vía QuickChart (Chart.js server-side, sin JS
  // en el cliente de email). Sin API key; si el cliente bloquea imágenes,
  // la leyenda de abajo tiene la misma información.
  const chartConfig = {
    type: 'pie',
    data: {
      labels: slices.map(s => `${s.label} (${pct(s.count)}%)`),
      datasets: [{
        data: slices.map(s => s.count),
        backgroundColor: slices.map(s => s.color),
        borderWidth: 1,
        borderColor: '#ffffff'
      }]
    },
    options: { legend: { position: 'right', labels: { fontSize: 11 } } }
  };
  const chartUrl = `https://quickchart.io/chart?w=420&h=220&bkg=white&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

  const trStyle = 'border-bottom:1px solid #e5e7eb;';
  const legendHtml = slices.map(s => `
    <tr style="${trStyle}">
      <td style="padding:4px 8px 4px 0;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:${s.color};"></span></td>
      <td style="padding:4px 10px 4px 0;font-size:12px;color:#111827;">${s.label}</td>
      <td style="padding:4px 10px 4px 0;font-size:12px;color:#111827;text-align:right;">${s.count}</td>
      <td style="padding:4px 0;font-size:12px;color:#6b7280;text-align:right;">${pct(s.count)}%</td>
    </tr>`).join('');

  const html = `
  <div style="margin-top:24px;padding:16px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
    <h3 style="margin:0 0 4px 0;font-size:14px;color:#111827;">Origen de las notificaciones (hoy)</h3>
    <p style="margin:0 0 10px 0;font-size:11px;color:#9ca3af;">Movimientos y cédulas con estado 'sent' del día (hora Argentina), agrupados por fuente.</p>
    <img src="${chartUrl}" width="420" height="220" alt="Distribución por fuente" style="display:block;max-width:100%;height:auto;margin:0 0 10px 0;" />
    <table style="border-collapse:collapse;">
      ${legendHtml}
      <tr>
        <td style="padding:6px 8px 0 0;"></td>
        <td style="padding:6px 10px 0 0;font-size:12px;font-weight:bold;color:#111827;">Total</td>
        <td style="padding:6px 10px 0 0;font-size:12px;font-weight:bold;color:#111827;text-align:right;">${total}</td>
        <td style="padding:6px 0 0 0;"></td>
      </tr>
    </table>
  </div>`;

  const text = '\n\nORIGEN DE LAS NOTIFICACIONES (HOY)\n' +
    slices.map(s => `- ${s.label}: ${s.count} (${pct(s.count)}%)`).join('\n') +
    `\n- Total: ${total}\n`;

  return { html, text };
}

/**
 * Sección informativa "Configuración vigente" para el reporte del admin.
 * Se inyecta al final del email de judicial-movement-report para que cada
 * reporte documente con qué configuración corrió el sistema.
 *
 * @param {Object|null} config - doc de judicial-notification-configs (o null)
 * @returns {{html: string, text: string}}
 */
function buildConfigSummarySection(config) {
  if (!config) {
    return {
      html: '<p style="font-size:12px;color:#6b7280;">Configuración no disponible al momento del reporte.</p>',
      text: '\n\nConfiguración: no disponible al momento del reporte.\n'
    };
  }

  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const fmtDays = (days) => (Array.isArray(days) && days.length > 0 ? days.map(d => dayNames[d] ?? d).join(', ') : '—');
  const fmtList = (arr) => (Array.isArray(arr) && arr.length > 0 ? arr.join(', ') : 'ninguno');
  const onOff = (v, def = true) => ((v === undefined ? def : v !== false) ? 'Sí' : 'No');

  const status = config.status || {};
  const sched = config.notificationSchedule || {};
  const limits = config.limits || {};
  const filters = config.filters || {};
  const retention = config.dataRetention || {};
  const mp = config.movementPolicies || {};
  const defaults = mp.defaults || {};

  const rows = [
    ['Notificaciones habilitadas', `${onOff(status.enabled)} (modo: ${status.mode || 'production'})`],
    ['Coordinador interno PJN', onOff(status.coordinatorEnabled)],
    ['Cédulas (bandeja PJN)', onOff(status.cedulasEnabled)],
    ['Hora de entrega', `${sched.dailyNotificationHour ?? 19}:${String(sched.dailyNotificationMinute ?? 0).padStart(2, '0')} (${sched.timezone || 'America/Argentina/Buenos_Aires'})`],
    ['Días activos', fmtDays(sched.activeDays)],
    ['Horas de reporte', fmtList(sched.reportHours)],
    ['Máx. movimientos por batch', String(limits.maxMovementsPerBatch ?? 100)],
    ['Límites por usuario (entrega)', limits.enforcePerUserLimits === true
      ? `Activos — máx ${limits.maxNotificationsPerUserPerDay ?? 50}/día, ${limits.minHoursBetweenSameExpediente ?? 24} h entre mismo expediente`
      : 'Desactivados (declarativos)'],
    ['Tipos excluidos', fmtList(filters.excludedMovementTypes)],
    ['Keywords excluidas', fmtList(filters.excludedKeywords)],
    ['Tipos incluidos (whitelist)', fmtList(filters.includedMovementTypes)],
    ['Política default', `1ª sync: ${defaults.firstSyncPolicy || '(fallback worker)'} · día no activo: ${defaults.offDayMode || 'skip'} · archivados: ${onOff(defaults.notifyArchivedFolders)} · habilitada: ${onOff(defaults.enabled)}`],
    ['Retención', `sent ${retention.judicialMovementRetentionDays ?? 60} d · skipped ${retention.skippedRetentionDays ?? 30} d · logs ${retention.notificationLogRetentionDays ?? 30} d`]
  ];

  const sourceEntries = Object.entries(mp.sources || {});
  const sourceLines = sourceEntries.map(([key, pol]) => {
    const parts = [];
    if (pol.enabled !== undefined) parts.push(`habilitada: ${pol.enabled ? 'Sí' : 'No'}`);
    if (pol.firstSyncPolicy) parts.push(`1ª sync: ${pol.firstSyncPolicy}`);
    if (pol.offDayMode) parts.push(`día no activo: ${pol.offDayMode}`);
    if (pol.notifyArchivedFolders !== undefined) parts.push(`archivados: ${pol.notifyArchivedFolders ? 'Sí' : 'No'}`);
    if (pol.cacheSourceTodayOnly !== undefined) parts.push(`cache solo hoy: ${pol.cacheSourceTodayOnly ? 'Sí' : 'No'}`);
    if (pol.activeDays) parts.push(`días: ${fmtDays(pol.activeDays)}`);
    if (pol.filters) parts.push('filtros propios');
    return [key, parts.length > 0 ? parts.join(' · ') : 'hereda defaults'];
  });

  const trStyle = 'border-bottom:1px solid #e5e7eb;';
  const tdLabel = 'padding:4px 10px 4px 0;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;';
  const tdValue = 'padding:4px 0;font-size:12px;color:#111827;';

  const rowsHtml = rows.map(([label, value]) =>
    `<tr style="${trStyle}"><td style="${tdLabel}">${label}</td><td style="${tdValue}">${value}</td></tr>`
  ).join('');
  const sourcesHtml = sourceLines.map(([key, desc]) =>
    `<tr style="${trStyle}"><td style="${tdLabel}"><code style="font-size:11px;">${key}</code></td><td style="${tdValue}">${desc}</td></tr>`
  ).join('');

  const html = `
  <div style="margin-top:24px;padding:16px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
    <h3 style="margin:0 0 4px 0;font-size:14px;color:#111827;">Configuración vigente</h3>
    <p style="margin:0 0 10px 0;font-size:11px;color:#9ca3af;">Valores del documento judicial-notification-configs al momento de este reporte. Editable en dashboard.lawanalytics.app → Notificaciones → Movimientos Judiciales → Configuración.</p>
    <table style="border-collapse:collapse;width:100%;">${rowsHtml}</table>
    ${sourceLines.length > 0 ? `<h4 style="margin:12px 0 4px 0;font-size:12px;color:#111827;">Overrides por source</h4><table style="border-collapse:collapse;width:100%;">${sourcesHtml}</table>` : ''}
  </div>`;

  const text = '\n\nCONFIGURACIÓN VIGENTE\n' +
    rows.map(([label, value]) => `- ${label}: ${value}`).join('\n') +
    (sourceLines.length > 0 ? '\nOverrides por source:\n' + sourceLines.map(([k, d]) => `- ${k}: ${d}`).join('\n') : '') +
    '\n';

  return { html, text };
}