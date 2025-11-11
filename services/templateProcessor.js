const { EmailTemplate } = require('../models');
const logger = require('../config/logger');

/**
 * Procesa un template reemplazando las variables con los valores proporcionados
 * @param {string} template - String del template con variables {{variable}} o ${variable}
 * @param {Object} data - Objeto con los valores para reemplazar
 * @returns {string} - Template procesado
 */
function processTemplate(template, data) {
  let processed = template;

  // Reemplazar cada variable en el template
  Object.keys(data).forEach(key => {
    // Reemplazar formato {{variable}}
    const regexDoubleBraces = new RegExp(`{{${key}}}`, 'g');
    processed = processed.replace(regexDoubleBraces, data[key] || '');

    // Reemplazar formato ${variable}
    // Escapamos el $ para la expresión regular
    const regexDollarBraces = new RegExp(`\\$\\{${key}\\}`, 'g');
    processed = processed.replace(regexDollarBraces, data[key] || '');
  });

  return processed;
}

/**
 * Obtiene y procesa un email template de la base de datos
 * @param {string} category - Categoría del template
 * @param {string} name - Nombre del template
 * @param {Object} variables - Variables para reemplazar en el template
 * @returns {Object} - Template procesado con subject, html y text
 */
async function getProcessedTemplate(category, name, variables) {
  try {
    // Buscar template activo
    const template = await EmailTemplate.findOne({
      category,
      name,
      isActive: true
    });

    if (!template) {
      throw new Error(`Template no encontrado: ${category}/${name}`);
    }

    // Procesar subject, html y text
    const processedSubject = processTemplate(template.subject, variables);
    const processedHtml = processTemplate(template.htmlContent || template.htmlBody || '', variables);
    const processedText = processTemplate(template.textContent || template.textBody || '', variables);

    return {
      subject: processedSubject,
      html: processedHtml,
      text: processedText,
      template: template
    };
  } catch (error) {
    logger.error(`Error procesando template ${category}/${name}:`, error);
    throw error;
  }
}

/**
 * Procesa datos específicos para movimientos judiciales
 * @param {Array} movementsByExpediente - Movimientos agrupados por expediente
 * @param {Object} user - Usuario destinatario
 * @returns {Object} - Variables procesadas para el template
 */
function processJudicialMovementsData(movementsByExpediente, user) {
  const moment = require('moment');
  
  // Generar HTML para todos los expedientes
  let expedientesHtml = '';
  let expedientesText = '';
  
  // Template base (se puede mejorar cargándolo desde el template)
  const expedienteTemplate = `
<div style="margin-bottom: 30px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px;">
  <h3 style="color: #1f2937; margin-bottom: 15px; font-size: 18px;">
    Expediente {{number}}/{{year}} - {{fuero}}
  </h3>
  <p style="font-size: 14px; color: #6b7280; margin-bottom: 15px;">
    <strong>Carátula:</strong> {{caratula}}
  </p>
  <table style="border-collapse: collapse; width: 100%; margin-bottom: 15px;">
    <thead>
      <tr style="background-color: #f0f4f8;">
        <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left; font-weight: 600; color: #374151;">Fecha</th>
        <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left; font-weight: 600; color: #374151;">Tipo</th>
        <th style="border: 1px solid #e5e7eb; padding: 10px; text-align: left; font-weight: 600; color: #374151;">Detalle</th>
      </tr>
    </thead>
    <tbody>
      {{movimientosRows}}
    </tbody>
  </table>
</div>`;

  const movimientoRowTemplate = `
<tr>
  <td style="border: 1px solid #e5e7eb; padding: 10px; color: #4b5563;">{{fecha}}</td>
  <td style="border: 1px solid #e5e7eb; padding: 10px; color: #4b5563;">{{tipo}}</td>
  <td style="border: 1px solid #e5e7eb; padding: 10px; color: #4b5563;">
    {{detalle}}
    {{urlHtml}}
  </td>
</tr>`;

  // Procesar cada expediente
  for (const [key, data] of Object.entries(movementsByExpediente)) {
    const { expediente, movements } = data;
    
    // Generar filas de movimientos
    let movimientosRows = '';
    let movimientosText = '';
    
    movements.forEach(movement => {
      const fecha = moment(movement.movimiento.fecha).format('DD/MM/YYYY');
      
      // HTML row
      const urlHtml = movement.movimiento.url 
        ? `<br><a href="${movement.movimiento.url}" style="color: #2563eb; font-size: 12px; text-decoration: none;">Ver documento</a>`
        : '';
      
      movimientosRows += processTemplate(movimientoRowTemplate, {
        fecha,
        tipo: movement.movimiento.tipo,
        detalle: movement.movimiento.detalle,
        urlHtml
      });
      
      // Text version
      movimientosText += `- ${fecha}: ${movement.movimiento.tipo} - ${movement.movimiento.detalle}\n`;
      if (movement.movimiento.url) {
        movimientosText += `  Ver documento: ${movement.movimiento.url}\n`;
      }
    });
    
    // Procesar template del expediente
    expedientesHtml += processTemplate(expedienteTemplate, {
      number: expediente.number,
      year: expediente.year,
      fuero: expediente.fuero,
      caratula: expediente.caratula,
      movimientosRows
    });
    
    // Versión texto
    expedientesText += `\nExpediente ${expediente.number}/${expediente.year} - ${expediente.fuero}\n`;
    expedientesText += `Carátula: ${expediente.caratula}\n\n`;
    expedientesText += movimientosText;
  }
  
  return {
    userName: user.name || user.email || 'Usuario',
    userEmail: user.email,
    expedientesCount: Object.keys(movementsByExpediente).length,
    expedientesHtml,
    expedientesText,
    'process.env.BASE_URL': process.env.BASE_URL || ''
  };
}

module.exports = {
  processTemplate,
  getProcessedTemplate,
  processJudicialMovementsData
};