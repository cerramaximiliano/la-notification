/**
 * Script para crear el template de email para reportes de movimientos judiciales
 *
 * Ejecutar con: node scripts/createJudicialMovementReportTemplate.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const templateData = {
  category: 'administration',
  name: 'judicial-movement-report',
  subject: '{{statusIcon}} Reporte de Movimientos Judiciales - {{fechaProcesada}}',
  description: 'Template para el reporte de administración sobre notificaciones de movimientos judiciales',
  variables: [
    'statusIcon', 'statusText', 'statusColor',
    'causasEncontradas', 'movimientosDelDia', 'usuariosVinculados',
    'notificacionesExistentes', 'notificacionesCreadas', 'erroresCoordinacion',
    'usuariosPendientes', 'notificacionesEnviadas', 'usuariosExitosos', 'usuariosFallidos',
    'totalDocumentosCreados', 'totalNotificacionesEnviadas', 'totalErrores',
    'timestamp', 'fechaProcesada'
  ],
  tags: ['admin', 'judicial', 'report', 'monitoring'],
  isActive: true,
  htmlContent: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reporte de Movimientos Judiciales</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); border-radius: 12px 12px 0 0; padding: 30px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px;">⚖️ Movimientos Judiciales</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 14px;">Reporte de Monitoreo</p>
    </div>

    <!-- Status Banner -->
    <div style="background-color: {{statusColor}}; padding: 15px; text-align: center;">
      <span style="color: white; font-size: 18px; font-weight: 600;">{{statusIcon}} {{statusText}}</span>
    </div>

    <!-- Content -->
    <div style="background-color: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">

      <!-- Fecha y Hora -->
      <div style="text-align: center; margin-bottom: 25px; padding-bottom: 20px; border-bottom: 1px solid #e5e7eb;">
        <p style="color: #6b7280; margin: 0; font-size: 14px;">
          📅 Fecha procesada: <strong>{{fechaProcesada}}</strong><br>
          🕐 Ejecutado: <strong>{{timestamp}}</strong>
        </p>
      </div>

      <!-- Sección: Coordinación -->
      <div style="margin-bottom: 25px;">
        <h2 style="color: #1f2937; font-size: 16px; margin: 0 0 15px; padding-bottom: 10px; border-bottom: 2px solid #3b82f6;">
          🔄 PASO 1: Coordinación
        </h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Causas encontradas</td>
            <td style="padding: 8px 0; text-align: right; color: #1f2937; font-weight: 600; font-size: 14px;">{{causasEncontradas}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Movimientos del día</td>
            <td style="padding: 8px 0; text-align: right; color: #1f2937; font-weight: 600; font-size: 14px;">{{movimientosDelDia}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Usuarios vinculados</td>
            <td style="padding: 8px 0; text-align: right; color: #1f2937; font-weight: 600; font-size: 14px;">{{usuariosVinculados}}</td>
          </tr>
          <tr style="background-color: #f0fdf4;">
            <td style="padding: 8px; color: #166534; font-size: 14px;">✅ Documentos creados</td>
            <td style="padding: 8px; text-align: right; color: #166534; font-weight: 600; font-size: 14px;">{{notificacionesCreadas}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Ya existentes (no duplicados)</td>
            <td style="padding: 8px 0; text-align: right; color: #6b7280; font-size: 14px;">{{notificacionesExistentes}}</td>
          </tr>
          <tr style="background-color: #fef2f2;">
            <td style="padding: 8px; color: #991b1b; font-size: 14px;">❌ Errores</td>
            <td style="padding: 8px; text-align: right; color: #991b1b; font-weight: 600; font-size: 14px;">{{erroresCoordinacion}}</td>
          </tr>
        </table>
      </div>

      <!-- Sección: Notificación -->
      <div style="margin-bottom: 25px;">
        <h2 style="color: #1f2937; font-size: 16px; margin: 0 0 15px; padding-bottom: 10px; border-bottom: 2px solid #10b981;">
          📧 PASO 2: Notificación
        </h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Usuarios con pendientes</td>
            <td style="padding: 8px 0; text-align: right; color: #1f2937; font-weight: 600; font-size: 14px;">{{usuariosPendientes}}</td>
          </tr>
          <tr style="background-color: #f0fdf4;">
            <td style="padding: 8px; color: #166534; font-size: 14px;">✅ Notificaciones enviadas</td>
            <td style="padding: 8px; text-align: right; color: #166534; font-weight: 600; font-size: 14px;">{{notificacionesEnviadas}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Usuarios exitosos</td>
            <td style="padding: 8px 0; text-align: right; color: #1f2937; font-weight: 600; font-size: 14px;">{{usuariosExitosos}}</td>
          </tr>
          <tr style="background-color: #fef2f2;">
            <td style="padding: 8px; color: #991b1b; font-size: 14px;">❌ Usuarios fallidos</td>
            <td style="padding: 8px; text-align: right; color: #991b1b; font-weight: 600; font-size: 14px;">{{usuariosFallidos}}</td>
          </tr>
        </table>
      </div>

      <!-- Resumen Total -->
      <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-top: 20px;">
        <h3 style="color: #1f2937; font-size: 14px; margin: 0 0 15px; text-transform: uppercase; letter-spacing: 0.5px;">
          📊 Resumen Total
        </h3>
        <div style="display: flex; justify-content: space-around; text-align: center;">
          <div style="flex: 1;">
            <p style="color: #10b981; font-size: 28px; font-weight: 700; margin: 0;">{{totalDocumentosCreados}}</p>
            <p style="color: #6b7280; font-size: 12px; margin: 5px 0 0;">Docs Creados</p>
          </div>
          <div style="flex: 1;">
            <p style="color: #3b82f6; font-size: 28px; font-weight: 700; margin: 0;">{{totalNotificacionesEnviadas}}</p>
            <p style="color: #6b7280; font-size: 12px; margin: 5px 0 0;">Emails Enviados</p>
          </div>
          <div style="flex: 1;">
            <p style="color: #ef4444; font-size: 28px; font-weight: 700; margin: 0;">{{totalErrores}}</p>
            <p style="color: #6b7280; font-size: 12px; margin: 5px 0 0;">Errores</p>
          </div>
        </div>
      </div>

    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
      <p style="margin: 0;">Law||Analytics - Sistema de Notificaciones</p>
      <p style="margin: 5px 0 0;">Este es un mensaje automático de monitoreo</p>
    </div>

  </div>
</body>
</html>`,
  textContent: `REPORTE DE MOVIMIENTOS JUDICIALES
================================

Estado: {{statusText}}
Fecha procesada: {{fechaProcesada}}
Ejecutado: {{timestamp}}

PASO 1: COORDINACIÓN
--------------------
Causas encontradas: {{causasEncontradas}}
Movimientos del día: {{movimientosDelDia}}
Usuarios vinculados: {{usuariosVinculados}}
Documentos creados: {{notificacionesCreadas}}
Ya existentes: {{notificacionesExistentes}}
Errores: {{erroresCoordinacion}}

PASO 2: NOTIFICACIÓN
--------------------
Usuarios con pendientes: {{usuariosPendientes}}
Notificaciones enviadas: {{notificacionesEnviadas}}
Usuarios exitosos: {{usuariosExitosos}}
Usuarios fallidos: {{usuariosFallidos}}

RESUMEN TOTAL
-------------
Total documentos creados: {{totalDocumentosCreados}}
Total notificaciones enviadas: {{totalNotificacionesEnviadas}}
Total errores: {{totalErrores}}

---
Law||Analytics - Sistema de Notificaciones
Este es un mensaje automático de monitoreo`
};

async function createTemplate() {
  try {
    console.log('Conectando a MongoDB...');
    await mongoose.connect(process.env.URLDB);
    console.log('Conectado exitosamente\n');

    const EmailTemplate = require('../models/EmailTemplate');

    // Verificar si ya existe
    const existing = await EmailTemplate.findOne({
      category: templateData.category,
      name: templateData.name
    });

    if (existing) {
      console.log('Template ya existe. Actualizando...');
      await EmailTemplate.updateOne(
        { category: templateData.category, name: templateData.name },
        { $set: templateData }
      );
      console.log('✅ Template actualizado exitosamente');
    } else {
      console.log('Creando nuevo template...');
      await EmailTemplate.create(templateData);
      console.log('✅ Template creado exitosamente');
    }

    console.log(`\nTemplate: ${templateData.category}/${templateData.name}`);
    console.log(`Subject: ${templateData.subject}`);
    console.log(`Variables: ${templateData.variables.length}`);

    await mongoose.disconnect();
    console.log('\nDesconectado de MongoDB');

  } catch (error) {
    console.error('Error:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

createTemplate();
