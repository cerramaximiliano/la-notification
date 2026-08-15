const moment = require('moment');
const { esc } = require('./htmlEscape');

/**
 * Obtiene la fecha de referencia para calcular inactividad de un folder
 *
 * REGLA: Si existe lastMovementDate, se usa SOLO esa fecha.
 * Si no existe, se usa la fecha más reciente de las demás fechas disponibles.
 *
 * @param {Object} folder - Documento del folder
 * @returns {Date|null} - Fecha de referencia o null si no hay fechas
 */
function getMostRecentDate(folder) {
  // Si existe lastMovementDate, usar SOLO esa fecha
  if (folder.lastMovementDate) {
    return new Date(folder.lastMovementDate);
  }

  // Si no hay lastMovementDate, buscar la más reciente de las demás fechas
  const dates = [];

  if (folder.initialDateFolder) dates.push(new Date(folder.initialDateFolder));
  if (folder.finalDateFolder) dates.push(new Date(folder.finalDateFolder));

  // Fechas del judFolder (etapa judicial)
  if (folder.judFolder) {
    if (folder.judFolder.initialDateJudFolder) dates.push(new Date(folder.judFolder.initialDateJudFolder));
    if (folder.judFolder.finalDateJudFolder) dates.push(new Date(folder.judFolder.finalDateJudFolder));
  }

  if (dates.length === 0) return null;

  // Retornar la fecha más reciente de las alternativas
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

// Pill chica estilo unificado (mismo lenguaje visual que el email de movimientos)
function pill(text, bg, color, border) {
  return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;background-color:${bg};color:${color};border:1px solid ${border};">${text}</span>`;
}

/**
 * Cards de folders (diseño unificado 2026-08: cards blancas sobre la
 * superficie gris del shell). Compartido por caducidad y prescripción.
 *
 * @param {Array} folders
 * @param {Object} settings
 * @param {'caducity'|'prescription'} kind
 * @returns {{foldersTableHtml: string, foldersListText: string}}
 */
function buildFolderCards(folders, settings, kind) {
  const limitDays = kind === 'caducity' ? settings.caducityDays : settings.prescriptionDays;
  const limitLabel = kind === 'caducity' ? 'Caducidad' : 'Prescripción';
  // Umbrales de urgencia distintos: caducidad se mide en días cortos,
  // prescripción en ventanas más largas (mismos cortes que el diseño previo).
  const urgentAt = kind === 'caducity' ? 3 : 7;
  const warnAt = kind === 'caducity' ? 7 : 30;

  let foldersTableHtml = '';
  let foldersListText = '';

  folders.forEach(folder => {
    const lastActivityDate = getMostRecentDate(folder);
    const limitDate = moment.utc(lastActivityDate).add(limitDays, 'days');
    const daysRemaining = calculateDaysRemaining(lastActivityDate, limitDays);

    const formattedLastActivity = moment.utc(lastActivityDate).format('DD/MM/YYYY');
    const formattedLimitDate = limitDate.format('DD/MM/YYYY');

    let urgencyPill;
    if (daysRemaining <= 0) {
      urgencyPill = pill('Vencido', '#FEF2F2', '#DC2626', '#FECACA');
    } else if (daysRemaining <= urgentAt) {
      urgencyPill = pill(`${daysRemaining} día(s)`, '#FEF2F2', '#DC2626', '#FECACA');
    } else if (daysRemaining <= warnAt) {
      urgencyPill = pill(`${daysRemaining} días`, '#FFF7ED', '#B45309', '#FDBA74');
    } else {
      urgencyPill = pill(`${daysRemaining} días`, '#EFF4FF', '#3A7BFF', '#C7D8FF');
    }

    foldersTableHtml += `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E6EAF2;border-radius:8px;margin-bottom:10px;">
        <tr><td style="padding:12px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:13px;font-weight:600;color:#0F172A;">${esc(folder.folderName)}</td>
            <td align="right" style="white-space:nowrap;">${urgencyPill}</td>
          </tr></table>
          ${folder.materia ? `<p style="margin:4px 0 0 0;font-size:11px;color:#3A7BFF;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">${esc(folder.materia)}</p>` : ''}
          <p style="margin:6px 0 0 0;font-size:13px;line-height:1.55;color:#475569;">Última actividad: <b>${formattedLastActivity}</b> &nbsp;·&nbsp; ${limitLabel}: <b>${formattedLimitDate}</b></p>
        </td></tr>
      </table>`;

    foldersListText += `- ${folder.folderName} (${folder.materia || 'Sin materia'})\n`;
    foldersListText += `  Última actividad: ${formattedLastActivity}\n`;
    foldersListText += `  Fecha ${limitLabel.toLowerCase()}: ${formattedLimitDate}\n`;
    foldersListText += `  Días restantes: ${daysRemaining <= 0 ? 'VENCIDO' : daysRemaining}\n\n`;
  });

  return { foldersTableHtml, foldersListText };
}

/**
 * Procesa datos de folders para alertas de caducidad
 * @param {Array} folders - Array de folders con alerta de caducidad
 * @param {Object} user - Usuario destinatario
 * @param {Object} settings - Configuración de inactivitySettings
 * @returns {Object} - Variables procesadas para el template
 */
function processCaducityData(folders, user, settings) {
  const { foldersTableHtml, foldersListText } = buildFolderCards(folders, settings, 'caducity');

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
  const { foldersTableHtml, foldersListText } = buildFolderCards(folders, settings, 'prescription');

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
