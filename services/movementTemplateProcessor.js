const moment = require('moment');
const { esc } = require('./htmlEscape');

// Pill chica estilo unificado (mismo lenguaje visual que el email de movimientos)
function pill(text, bg, color, border) {
  return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;background-color:${bg};color:${color};border:1px solid ${border};">${text}</span>`;
}

/**
 * Procesa datos de movimientos próximos a expirar para generar las variables del template.
 * Diseño unificado 2026-08: cards blancas sobre la superficie gris del shell.
 * @param {Array} movements - Array de movimientos próximos a expirar
 * @param {Object} user - Usuario destinatario
 * @returns {Object} - Variables procesadas para el template
 */
function processMovementsData(movements, user) {
  let movementsTableHtml = '';
  let movementsListText = '';

  movements.forEach((movement) => {
    const expDate = moment.utc(movement.dateExpiration);
    const formattedExpirationDate = expDate.format('DD/MM/YYYY');
    const daysUntilExpiration = expDate.diff(moment.utc().startOf('day'), 'days');

    let urgencyPill = '';
    if (daysUntilExpiration <= 0) {
      urgencyPill = ` ${pill('Vence hoy', '#FEF2F2', '#DC2626', '#FECACA')}`;
    } else if (daysUntilExpiration === 1) {
      urgencyPill = ` ${pill('Vence mañana', '#FFF7ED', '#B45309', '#FDBA74')}`;
    } else if (daysUntilExpiration <= 3) {
      urgencyPill = ` ${pill(`En ${daysUntilExpiration} días`, '#FFF7ED', '#B45309', '#FDBA74')}`;
    }

    movementsTableHtml += `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E6EAF2;border-radius:8px;margin-bottom:10px;">
        <tr><td style="padding:12px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:13px;font-weight:600;color:#0F172A;">${esc(movement.title)}${urgencyPill}</td>
            <td align="right" style="font-size:12px;color:#64748B;white-space:nowrap;">Expira ${formattedExpirationDate}</td>
          </tr></table>
          <p style="margin:4px 0 0 0;font-size:11px;color:#3A7BFF;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">${esc(movement.movement || 'Movimiento')}</p>
          ${movement.description ? `<p style="margin:6px 0 0 0;font-size:13px;line-height:1.55;color:#475569;">${esc(movement.description)}</p>` : ''}
        </td></tr>
      </table>`;

    movementsListText += `- ${formattedExpirationDate}`;
    if (daysUntilExpiration === 0) movementsListText += ' (HOY)';
    if (daysUntilExpiration === 1) movementsListText += ' (MAÑANA)';
    movementsListText += `: ${movement.title} (Tipo: ${movement.movement})\n`;
    if (movement.description) {
      movementsListText += `  ${movement.description}\n`;
    }
  });

  return {
    userName: user.name || user.email || 'Usuario',
    userEmail: user.email,
    movementsCount: movements.length,
    movementsTableHtml,
    movementsListText,
    'process.env.BASE_URL': process.env.BASE_URL || ''
  };
}

module.exports = {
  processMovementsData
};
