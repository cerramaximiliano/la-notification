const moment = require('moment');

/**
 * Procesa datos de movimientos próximos a expirar para generar las variables del template
 * @param {Array} movements - Array de movimientos próximos a expirar
 * @param {Object} user - Usuario destinatario
 * @returns {Object} - Variables procesadas para el template
 */
function processMovementsData(movements, user) {
  // Generar tabla HTML
  let movementsTableHtml = `
    <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
      <thead>
        <tr style="background-color: #fef3c7;">
          <th style="border: 1px solid #fbbf24; padding: 12px; text-align: left; font-weight: 600; color: #92400e;">Fecha de expiración</th>
          <th style="border: 1px solid #fbbf24; padding: 12px; text-align: left; font-weight: 600; color: #92400e;">Título</th>
          <th style="border: 1px solid #fbbf24; padding: 12px; text-align: left; font-weight: 600; color: #92400e;">Tipo de movimiento</th>
          <th style="border: 1px solid #fbbf24; padding: 12px; text-align: left; font-weight: 600; color: #92400e;">Descripción</th>
        </tr>
      </thead>
      <tbody>`;

  // Generar texto plano
  let movementsListText = '';

  // Procesar cada movimiento
  movements.forEach((movement, index) => {
    // Convertir fecha a UTC ignorando la zona horaria
    const expDate = moment.utc(movement.dateExpiration);
    
    // Formatear fecha en DD/MM/YYYY usando UTC
    const formattedExpirationDate = expDate.format('DD/MM/YYYY');
    
    // Calcular días hasta la expiración
    const daysUntilExpiration = expDate.diff(moment.utc().startOf('day'), 'days');
    
    // Determinar el estilo de la fila según urgencia
    let rowStyle = '';
    if (daysUntilExpiration <= 1) {
      rowStyle = 'background-color: #fee2e2;'; // Rojo claro para muy urgente
    } else if (daysUntilExpiration <= 3) {
      rowStyle = 'background-color: #fef3c7;'; // Amarillo claro para urgente
    }

    // Agregar fila a la tabla HTML
    movementsTableHtml += `
      <tr${rowStyle ? ` style="${rowStyle}"` : ''}>
        <td style="border: 1px solid #fbbf24; padding: 12px; color: #78350f;">
          ${formattedExpirationDate}
          ${daysUntilExpiration === 0 ? '<strong style="color: #dc2626;"> (HOY)</strong>' : ''}
          ${daysUntilExpiration === 1 ? '<strong style="color: #ea580c;"> (MAÑANA)</strong>' : ''}
        </td>
        <td style="border: 1px solid #fbbf24; padding: 12px; color: #78350f;">${movement.title}</td>
        <td style="border: 1px solid #fbbf24; padding: 12px; color: #78350f;">${movement.movement}</td>
        <td style="border: 1px solid #fbbf24; padding: 12px; color: #78350f;">${movement.description || '-'}</td>
      </tr>`;

    // Agregar al texto plano
    movementsListText += `- ${formattedExpirationDate}`;
    if (daysUntilExpiration === 0) movementsListText += ' (HOY)';
    if (daysUntilExpiration === 1) movementsListText += ' (MAÑANA)';
    movementsListText += `: ${movement.title} (Tipo: ${movement.movement})\n`;
    if (movement.description) {
      movementsListText += `  ${movement.description}\n`;
    }
  });

  movementsTableHtml += `
      </tbody>
    </table>`;

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