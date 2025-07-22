// Template para notificaciones de movimientos judiciales
module.exports = {
  category: 'notification',
  name: 'judicial-movements',
  subject: 'Law||Analytics: Nuevos movimientos en {{expedientesCount}} expediente(s)',
  preheader: 'Se han registrado nuevos movimientos en tus expedientes',
  description: 'Template para notificar movimientos judiciales a usuarios',
  tags: ['judicial', 'movements', 'notifications', 'legal'],
  variables: [
    'userName',
    'userEmail',
    'expedientesCount',
    'expedientesHtml',
    'expedientesText'
  ],
  htmlContent: `
<h2 style="color: #2563eb; margin-bottom: 20px; font-size: 24px; line-height: 1.3;">
  Nuevos movimientos judiciales
</h2>
<p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
  Hola {{userName}},
</p>
<p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
  Se han registrado nuevos movimientos en tus expedientes:
</p>

{{expedientesHtml}}

<p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
  Puedes ver todos los detalles en la sección de expedientes de tu cuenta de Law||Analytics.
</p>
<p style="font-size: 16px; line-height: 1.6;">
  Saludos,<br>El equipo de Law||Analytics
</p>`,
  
  textContent: `Nuevos movimientos judiciales

Hola {{userName}},

Se han registrado nuevos movimientos en tus expedientes:

{{expedientesText}}

Puedes ver todos los detalles en la sección de expedientes de tu cuenta de Law||Analytics.

Saludos,
El equipo de Law||Analytics`,

  // Template parcial para cada expediente (usado internamente)
  expedienteHtmlTemplate: `
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
</div>`,

  // Template parcial para cada movimiento
  movimientoRowTemplate: `
<tr>
  <td style="border: 1px solid #e5e7eb; padding: 10px; color: #4b5563;">{{fecha}}</td>
  <td style="border: 1px solid #e5e7eb; padding: 10px; color: #4b5563;">{{tipo}}</td>
  <td style="border: 1px solid #e5e7eb; padding: 10px; color: #4b5563;">
    {{detalle}}
    {{urlHtml}}
  </td>
</tr>`,

  // Template para texto plano de cada expediente
  expedienteTextTemplate: `
Expediente {{number}}/{{year}} - {{fuero}}
Carátula: {{caratula}}

{{movimientosText}}`,

  metadata: {
    version: '1.0',
    createdAt: new Date().toISOString(),
    requiredModels: ['JudicialMovement', 'User']
  }
};