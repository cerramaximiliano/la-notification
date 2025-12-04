const moment = require('moment');

/**
 * Obtiene la fecha más reciente de actividad de un folder
 * @param {Object} folder - Documento del folder
 * @returns {Date|null} - Fecha más reciente o null si no hay fechas
 */
function getMostRecentDate(folder) {
  const dates = [];

  // Fechas del folder principal
  if (folder.lastMovementDate) dates.push(new Date(folder.lastMovementDate));
  if (folder.initialDateFolder) dates.push(new Date(folder.initialDateFolder));
  if (folder.finalDateFolder) dates.push(new Date(folder.finalDateFolder));

  // Fechas del judFolder (etapa judicial)
  if (folder.judFolder) {
    if (folder.judFolder.initialDateJudFolder) dates.push(new Date(folder.judFolder.initialDateJudFolder));
    if (folder.judFolder.finalDateJudFolder) dates.push(new Date(folder.judFolder.finalDateJudFolder));
  }

  if (dates.length === 0) return null;

  // Retornar la fecha más reciente
  return dates.reduce((latest, current) => current > latest ? current : latest);
}

/**
 * Calcula los días restantes hasta una fecha límite
 * @param {Date} lastActivityDate - Fecha de última actividad
 * @param {Number} limitDays - Días de caducidad o prescripción
 * @returns {Number} - Días restantes (negativo si ya venció)
 */
function calculateDaysRemaining(lastActivityDate, limitDays) {
  const limitDate = moment.utc(lastActivityDate).add(limitDays, 'days');
  const today = moment.utc().startOf('day');
  return limitDate.diff(today, 'days');
}

/**
 * Procesa datos de folders para alertas de caducidad
 * @param {Array} folders - Array de folders con alerta de caducidad
 * @param {Object} user - Usuario destinatario
 * @param {Object} settings - Configuración de inactivitySettings
 * @returns {Object} - Variables procesadas para el template
 */
function processCaducityData(folders, user, settings) {
  // Generar tabla HTML
  let foldersTableHtml = `
    <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
      <thead>
        <tr style="background-color: #fee2e2;">
          <th style="border: 1px solid #fca5a5; padding: 12px; text-align: left; font-weight: 600; color: #991b1b;">Carpeta</th>
          <th style="border: 1px solid #fca5a5; padding: 12px; text-align: left; font-weight: 600; color: #991b1b;">Materia</th>
          <th style="border: 1px solid #fca5a5; padding: 12px; text-align: left; font-weight: 600; color: #991b1b;">Última Actividad</th>
          <th style="border: 1px solid #fca5a5; padding: 12px; text-align: left; font-weight: 600; color: #991b1b;">Fecha Caducidad</th>
          <th style="border: 1px solid #fca5a5; padding: 12px; text-align: left; font-weight: 600; color: #991b1b;">Días Restantes</th>
        </tr>
      </thead>
      <tbody>`;

  // Generar texto plano
  let foldersListText = '';

  // Procesar cada folder
  folders.forEach(folder => {
    const lastActivityDate = getMostRecentDate(folder);
    const caducityDate = moment.utc(lastActivityDate).add(settings.caducityDays, 'days');
    const daysRemaining = calculateDaysRemaining(lastActivityDate, settings.caducityDays);

    // Formato de fechas
    const formattedLastActivity = moment.utc(lastActivityDate).format('DD/MM/YYYY');
    const formattedCaducityDate = caducityDate.format('DD/MM/YYYY');

    // Determinar el estilo de la fila según urgencia
    let rowStyle = '';
    let urgencyText = '';
    if (daysRemaining <= 0) {
      rowStyle = 'background-color: #fee2e2;'; // Rojo - vencido
      urgencyText = '<strong style="color: #dc2626;">VENCIDO</strong>';
    } else if (daysRemaining <= 3) {
      rowStyle = 'background-color: #fef3c7;'; // Amarillo - muy urgente
      urgencyText = `<strong style="color: #d97706;">${daysRemaining}</strong>`;
    } else if (daysRemaining <= 7) {
      rowStyle = 'background-color: #fef9c3;'; // Amarillo claro - urgente
      urgencyText = `<strong style="color: #ca8a04;">${daysRemaining}</strong>`;
    } else {
      urgencyText = `${daysRemaining}`;
    }

    // Agregar fila a la tabla HTML
    foldersTableHtml += `
      <tr${rowStyle ? ` style="${rowStyle}"` : ''}>
        <td style="border: 1px solid #fca5a5; padding: 12px; color: #7f1d1d;">${folder.folderName}</td>
        <td style="border: 1px solid #fca5a5; padding: 12px; color: #7f1d1d;">${folder.materia || '-'}</td>
        <td style="border: 1px solid #fca5a5; padding: 12px; color: #7f1d1d;">${formattedLastActivity}</td>
        <td style="border: 1px solid #fca5a5; padding: 12px; color: #7f1d1d;">${formattedCaducityDate}</td>
        <td style="border: 1px solid #fca5a5; padding: 12px; color: #7f1d1d; text-align: center;">${urgencyText}</td>
      </tr>`;

    // Agregar al texto plano
    foldersListText += `- ${folder.folderName} (${folder.materia || 'Sin materia'})\n`;
    foldersListText += `  Última actividad: ${formattedLastActivity}\n`;
    foldersListText += `  Fecha caducidad: ${formattedCaducityDate}\n`;
    foldersListText += `  Días restantes: ${daysRemaining <= 0 ? 'VENCIDO' : daysRemaining}\n\n`;
  });

  foldersTableHtml += `
      </tbody>
    </table>`;

  return {
    userName: user.name || user.email || 'Usuario',
    userEmail: user.email,
    foldersCount: folders.length,
    foldersTableHtml,
    foldersListText,
    alertType: 'caducidad',
    alertTypeTitle: 'Caducidad por Inactividad',
    caducityDays: settings.caducityDays,
    daysInAdvance: settings.daysInAdvance,
    'process.env.BASE_URL': process.env.BASE_URL || ''
  };
}

/**
 * Procesa datos de folders para alertas de prescripción
 * @param {Array} folders - Array de folders con alerta de prescripción
 * @param {Object} user - Usuario destinatario
 * @param {Object} settings - Configuración de inactivitySettings
 * @returns {Object} - Variables procesadas para el template
 */
function processPrescriptionData(folders, user, settings) {
  // Generar tabla HTML
  let foldersTableHtml = `
    <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
      <thead>
        <tr style="background-color: #fef3c7;">
          <th style="border: 1px solid #fbbf24; padding: 12px; text-align: left; font-weight: 600; color: #92400e;">Carpeta</th>
          <th style="border: 1px solid #fbbf24; padding: 12px; text-align: left; font-weight: 600; color: #92400e;">Materia</th>
          <th style="border: 1px solid #fbbf24; padding: 12px; text-align: left; font-weight: 600; color: #92400e;">Última Actividad</th>
          <th style="border: 1px solid #fbbf24; padding: 12px; text-align: left; font-weight: 600; color: #92400e;">Fecha Prescripción</th>
          <th style="border: 1px solid #fbbf24; padding: 12px; text-align: left; font-weight: 600; color: #92400e;">Días Restantes</th>
        </tr>
      </thead>
      <tbody>`;

  // Generar texto plano
  let foldersListText = '';

  // Procesar cada folder
  folders.forEach(folder => {
    const lastActivityDate = getMostRecentDate(folder);
    const prescriptionDate = moment.utc(lastActivityDate).add(settings.prescriptionDays, 'days');
    const daysRemaining = calculateDaysRemaining(lastActivityDate, settings.prescriptionDays);

    // Formato de fechas
    const formattedLastActivity = moment.utc(lastActivityDate).format('DD/MM/YYYY');
    const formattedPrescriptionDate = prescriptionDate.format('DD/MM/YYYY');

    // Determinar el estilo de la fila según urgencia
    let rowStyle = '';
    let urgencyText = '';
    if (daysRemaining <= 0) {
      rowStyle = 'background-color: #fee2e2;'; // Rojo - vencido
      urgencyText = '<strong style="color: #dc2626;">VENCIDO</strong>';
    } else if (daysRemaining <= 7) {
      rowStyle = 'background-color: #fef3c7;'; // Amarillo - muy urgente
      urgencyText = `<strong style="color: #d97706;">${daysRemaining}</strong>`;
    } else if (daysRemaining <= 30) {
      rowStyle = 'background-color: #fef9c3;'; // Amarillo claro - urgente
      urgencyText = `<strong style="color: #ca8a04;">${daysRemaining}</strong>`;
    } else {
      urgencyText = `${daysRemaining}`;
    }

    // Agregar fila a la tabla HTML
    foldersTableHtml += `
      <tr${rowStyle ? ` style="${rowStyle}"` : ''}>
        <td style="border: 1px solid #fbbf24; padding: 12px; color: #78350f;">${folder.folderName}</td>
        <td style="border: 1px solid #fbbf24; padding: 12px; color: #78350f;">${folder.materia || '-'}</td>
        <td style="border: 1px solid #fbbf24; padding: 12px; color: #78350f;">${formattedLastActivity}</td>
        <td style="border: 1px solid #fbbf24; padding: 12px; color: #78350f;">${formattedPrescriptionDate}</td>
        <td style="border: 1px solid #fbbf24; padding: 12px; color: #78350f; text-align: center;">${urgencyText}</td>
      </tr>`;

    // Agregar al texto plano
    foldersListText += `- ${folder.folderName} (${folder.materia || 'Sin materia'})\n`;
    foldersListText += `  Última actividad: ${formattedLastActivity}\n`;
    foldersListText += `  Fecha prescripción: ${formattedPrescriptionDate}\n`;
    foldersListText += `  Días restantes: ${daysRemaining <= 0 ? 'VENCIDO' : daysRemaining}\n\n`;
  });

  foldersTableHtml += `
      </tbody>
    </table>`;

  return {
    userName: user.name || user.email || 'Usuario',
    userEmail: user.email,
    foldersCount: folders.length,
    foldersTableHtml,
    foldersListText,
    alertType: 'prescripcion',
    alertTypeTitle: 'Prescripción por Inactividad',
    prescriptionDays: settings.prescriptionDays,
    daysInAdvance: settings.daysInAdvance,
    'process.env.BASE_URL': process.env.BASE_URL || ''
  };
}

module.exports = {
  getMostRecentDate,
  calculateDaysRemaining,
  processCaducityData,
  processPrescriptionData
};
