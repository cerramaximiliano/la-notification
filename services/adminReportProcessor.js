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
 * Sección "Configuración vigente" para el reporte del admin.
 *
 * Muestra el comportamiento EFECTIVO (misma cascada de resolución que la
 * entrega y los workers: sources[clave] → defaults → fallback → base), no
 * las capas crudas del documento — así "activeDays Lun–Vie + offDayMode
 * skip en defaults" con overrides 'send' por jurisdicción se lee como lo
 * que realmente es: los fines de semana SÍ se entrega.
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
  const fmtDays = (days) => (Array.isArray(days) && days.length > 0 ? days.map(d => dayNames[d] ?? d).join(', ') : 'Lun–Vie');
  const fmtList = (arr) => (Array.isArray(arr) && arr.length > 0 ? arr.join(', ') : 'ninguno');
  const isOn = (v, def = true) => (v === undefined ? def : v !== false);

  const status = config.status || {};
  const sched = config.notificationSchedule || {};
  const limits = config.limits || {};
  const filters = config.filters || {};
  const retention = config.dataRetention || {};
  const mp = config.movementPolicies || {};

  // ---- Resolución efectiva (cascada idéntica a workers/entrega) ----
  const BASE = { enabled: true, firstSyncPolicy: 'silent-baseline', offDayMode: 'skip', notifyArchivedFolders: true };
  const resolve = (key, fallback = {}) => {
    const layers = [(mp.sources || {})[key] || {}, mp.defaults || {}, fallback, BASE];
    const pick = (f) => { for (const l of layers) { if (l[f] !== undefined && l[f] !== null) return l[f]; } return undefined; };
    return {
      enabled: pick('enabled'),
      firstSyncPolicy: pick('firstSyncPolicy'),
      offDayMode: pick('offDayMode'),
      notifyArchivedFolders: pick('notifyArchivedFolders'),
      cacheSourceTodayOnly: pick('cacheSourceTodayOnly')
    };
  };

  const WORKERS = [
    ['pjn-app-update-worker', 'PJN — app-update', { firstSyncPolicy: 'today-only', cacheSourceTodayOnly: true }],
    ['pjn-mis-causas-update-worker', 'PJN — Mis Causas', { firstSyncPolicy: 'silent-baseline' }],
    ['mev-update-worker', 'MEV — update', { firstSyncPolicy: 'silent-baseline' }],
    ['scba-update-worker', 'SCBA — update (+archived)', { firstSyncPolicy: 'today-only', notifyArchivedFolders: true }],
    ['eje-update-worker', 'EJE — update', { firstSyncPolicy: 'silent-baseline' }],
    ['eje-stuck-worker', 'EJE — stuck (first-touch)', { firstSyncPolicy: 'silent-baseline' }]
  ];
  const DELIVERY = [['pjn', 'PJN'], ['eje', 'EJE'], ['mev', 'MEV'], ['scba', 'SCBA']];

  const deliveryResolved = DELIVERY.map(([key, label]) => ({ key, label, ...resolve(key) }));
  const allWeekendSend = deliveryResolved.every(d => d.offDayMode === 'send');
  const weekendSendList = deliveryResolved.filter(d => d.offDayMode === 'send').map(d => d.label);
  const weekendLine = allWeekendSend
    ? 'Se entrega TODOS los días, incluidos fines de semana (todas las jurisdicciones)'
    : weekendSendList.length > 0
      ? `Fines de semana solo: ${weekendSendList.join(', ')} — el resto se difiere/descarta`
      : 'Solo días activos — fines de semana no se entrega';

  const OFF_DAY_LABEL = { send: 'entrega igual', skip: 'no envía', defer: 'difiere' };
  const FIRST_SYNC_LABEL = { 'silent-baseline': 'silenciosa', 'today-only': 'solo hoy', 'notify-all': 'todo ⚠️' };

  // ---- Helpers visuales (email-safe: tablas + estilos inline) ----
  const pill = (text, kind) => {
    const K = {
      green: ['#ECFDF5', '#059669'], amber: ['#FFFBEB', '#B45309'],
      gray: ['#F3F4F6', '#4B5563'], blue: ['#EFF6FF', '#1D4ED8'], red: ['#FEF2F2', '#DC2626']
    }[kind] || ['#F3F4F6', '#4B5563'];
    return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;background-color:${K[0]};color:${K[1]};">${text}</span>`;
  };
  const onOffPill = (on, lOn = 'Habilitado', lOff = 'Deshabilitado') => pill(on ? lOn : lOff, on ? 'green' : 'red');
  const row = (label, valueHtml) =>
    `<tr><td style="padding:4px 10px 4px 0;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${label}</td>` +
    `<td style="padding:4px 0;font-size:12px;color:#111827;">${valueHtml}</td></tr>`;
  const card = (title, rowsHtml) =>
    `<div style="border:1px solid #e5e7eb;border-radius:8px;background-color:#ffffff;padding:12px 14px;margin-bottom:10px;">` +
    `<div style="font-size:12px;font-weight:700;color:#111827;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.4px;">${title}</div>` +
    `<table style="border-collapse:collapse;width:100%;">${rowsHtml}</table></div>`;

  const globallyOn = isOn(status.enabled) && status.mode !== 'maintenance';

  const estadoCard = card('Estado',
    row('Sistema', `${onOffPill(globallyOn, 'Activo', status.mode === 'maintenance' ? 'Mantenimiento' : 'Deshabilitado')} <span style="color:#6b7280;">modo ${status.mode || 'production'}</span>`) +
    row('Coordinador interno PJN', onOffPill(isOn(status.coordinatorEnabled))) +
    row('Cédulas (bandeja PJN)', onOffPill(isOn(status.cedulasEnabled), 'Habilitadas', 'Deshabilitadas'))
  );

  const entregaCard = card('Entrega',
    row('Hora de entrega', `<b>${sched.dailyNotificationHour ?? 19}:${String(sched.dailyNotificationMinute ?? 0).padStart(2, '0')}</b> ART`) +
    row('Días activos', fmtDays(sched.activeDays)) +
    row('Fin de semana', allWeekendSend ? pill('✓ ' + weekendLine, 'green') : pill(weekendLine, 'amber')) +
    row('Límites por usuario', limits.enforcePerUserLimits === true
      ? `${pill('Activos', 'green')} máx ${limits.maxNotificationsPerUserPerDay ?? 50}/día · ${limits.minHoursBetweenSameExpediente ?? 24} h entre mismo expediente`
      : pill('Desactivados', 'gray')) +
    row('Batch máx.', String(limits.maxMovementsPerBatch ?? 100)) +
    row('Reportes admin', fmtList(sched.reportHours))
  );

  const filtrosCard = card('Filtros de contenido',
    row('Tipos excluidos', (filters.excludedMovementTypes || []).length ? filters.excludedMovementTypes.map(t => pill(t, 'amber')).join(' ') : pill('ninguno', 'gray')) +
    row('Keywords excluidas', (filters.excludedKeywords || []).length ? filters.excludedKeywords.map(t => pill(t, 'amber')).join(' ') : pill('ninguna', 'gray')) +
    row('Whitelist de tipos', (filters.includedMovementTypes || []).length ? filters.includedMovementTypes.map(t => pill(t, 'blue')).join(' ') : pill('sin whitelist (pasa todo)', 'gray'))
  );

  const retencionCard = card('Retención',
    row('Notificados (sent)', `${retention.judicialMovementRetentionDays ?? 60} días`) +
    row("Descartados ('skipped')", `${retention.skippedRetentionDays ?? 30} días`) +
    row('Logs', `${retention.notificationLogRetentionDays ?? 30} días`)
  );

  // ---- Tabla de políticas EFECTIVAS por fuente ----
  const th = (t) => `<th style="padding:6px 10px 6px 0;font-size:11px;color:#6b7280;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">${t}</th>`;
  const td = (t) => `<td style="padding:5px 10px 5px 0;font-size:12px;color:#111827;border-bottom:1px solid #f3f4f6;">${t}</td>`;

  const workerRows = WORKERS.map(([key, label, fb]) => {
    const r = resolve(key, fb);
    const extras = [];
    if (r.cacheSourceTodayOnly !== undefined && key === 'pjn-app-update-worker') extras.push(`cache: ${r.cacheSourceTodayOnly ? 'solo hoy' : 'sin filtro'}`);
    return `<tr>${td(`<b>${label}</b>`)}${td(r.enabled === false ? pill('OFF (kill-switch)', 'red') : pill('activa', 'green'))}` +
      `${td(FIRST_SYNC_LABEL[r.firstSyncPolicy] || r.firstSyncPolicy)}${td(OFF_DAY_LABEL[r.offDayMode] || r.offDayMode)}` +
      `${td(r.notifyArchivedFolders === false ? pill('filtra', 'green') : 'notifica')}${td(extras.join(' · ') || '—')}</tr>`;
  }).join('');

  const deliveryRows = deliveryResolved.map((r) =>
    `<tr>${td(`Entrega — <b>${r.label}</b>`)}${td(r.enabled === false ? pill('OFF (kill-switch)', 'red') : pill('activa', 'green'))}` +
    `${td('—')}${td(OFF_DAY_LABEL[r.offDayMode] || r.offDayMode)}` +
    `${td(r.notifyArchivedFolders === false ? pill('filtra', 'green') : 'notifica')}${td('barrera final')}</tr>`
  ).join('');

  const policiesTable =
    `<div style="border:1px solid #e5e7eb;border-radius:8px;background-color:#ffffff;padding:12px 14px;">` +
    `<div style="font-size:12px;font-weight:700;color:#111827;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.4px;">Políticas efectivas por fuente</div>` +
    `<div style="font-size:11px;color:#9ca3af;margin-bottom:8px;">Valores ya resueltos (override → defaults → código). "Día no activo: no envía" en un worker significa que ese día no postea — la fila "Entrega" de su jurisdicción define si lo pendiente/coordinado se entrega igual.</div>` +
    `<table style="border-collapse:collapse;width:100%;"><tr>${th('Fuente')}${th('Estado')}${th('1ª sync')}${th('Día no activo')}${th('Archivados')}${th('Extras')}</tr>` +
    workerRows + deliveryRows + `</table></div>`;

  const html = `
  <div style="margin-top:24px;padding:16px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
    <h3 style="margin:0 0 2px 0;font-size:14px;color:#111827;">Configuración vigente</h3>
    <p style="margin:0 0 12px 0;font-size:11px;color:#9ca3af;">Comportamiento efectivo al momento del reporte. Editable en dashboard.lawanalytics.app → Notificaciones → Movimientos Judiciales → Configuración.</p>
    <table style="border-collapse:collapse;width:100%;"><tr>
      <td style="vertical-align:top;width:50%;padding-right:6px;">${estadoCard}${filtrosCard}</td>
      <td style="vertical-align:top;width:50%;padding-left:6px;">${entregaCard}${retencionCard}</td>
    </tr></table>
    ${policiesTable}
  </div>`;

  const workerTextRows = WORKERS.map(([key, label, fb]) => {
    const r = resolve(key, fb);
    return `- ${label}: ${r.enabled === false ? 'OFF' : 'activa'} · 1ª sync ${FIRST_SYNC_LABEL[r.firstSyncPolicy] || r.firstSyncPolicy} · día no activo: ${OFF_DAY_LABEL[r.offDayMode] || r.offDayMode} · archivados: ${r.notifyArchivedFolders === false ? 'filtra' : 'notifica'}`;
  });
  const deliveryTextRows = deliveryResolved.map(r =>
    `- Entrega ${r.label}: ${r.enabled === false ? 'OFF' : 'activa'} · día no activo: ${OFF_DAY_LABEL[r.offDayMode] || r.offDayMode} · archivados: ${r.notifyArchivedFolders === false ? 'filtra' : 'notifica'}`
  );

  const text = '\n\nCONFIGURACIÓN VIGENTE (comportamiento efectivo)\n' +
    `- Sistema: ${globallyOn ? 'activo' : 'DESHABILITADO'} (modo ${status.mode || 'production'}) · Coordinador: ${isOn(status.coordinatorEnabled) ? 'sí' : 'no'} · Cédulas: ${isOn(status.cedulasEnabled) ? 'sí' : 'no'}\n` +
    `- Hora de entrega: ${sched.dailyNotificationHour ?? 19}:${String(sched.dailyNotificationMinute ?? 0).padStart(2, '0')} ART · Días activos: ${fmtDays(sched.activeDays)}\n` +
    `- Fin de semana: ${weekendLine}\n` +
    `- Filtros: tipos excluidos [${fmtList(filters.excludedMovementTypes)}] · keywords [${fmtList(filters.excludedKeywords)}]\n` +
    `- Límites por usuario: ${limits.enforcePerUserLimits === true ? 'activos' : 'desactivados'} · Retención: sent ${retention.judicialMovementRetentionDays ?? 60} d / skipped ${retention.skippedRetentionDays ?? 30} d / logs ${retention.notificationLogRetentionDays ?? 30} d\n` +
    'Políticas efectivas por fuente:\n' + workerTextRows.join('\n') + '\n' + deliveryTextRows.join('\n') + '\n';

  return { html, text };
}
