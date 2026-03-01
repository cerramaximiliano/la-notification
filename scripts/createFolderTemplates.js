/**
 * Script para crear los templates de notificación de inactividad de carpetas
 * Ejecutar con: node scripts/createFolderTemplates.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function createTemplates() {
  try {
    await mongoose.connect(process.env.URLDB);
    console.log('Conectado a MongoDB');

    const EmailTemplate = require('../models/EmailTemplate');

    // =====================================================
    // Template 1: folder-caducity (Alerta de Caducidad)
    // =====================================================
    const caducityHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Law||Analytics: Alerta de Caducidad</title>
  <style>
    @media screen and (max-width: 600px) {
      .container { width: 100% !important; padding: 10px !important; }
      .hero-title { font-size: 22px !important; }
      .hero-subtitle { font-size: 16px !important; }
      .content-text { font-size: 15px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #333; background-color: #f5f7fa;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f7fa;">
    <tr>
      <td align="center" style="padding: 30px;">
        <table class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 10px;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding: 25px;">
              <img src="https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png" alt="Law||Analytics Logo" style="max-width: 200px; height: auto;">
            </td>
          </tr>

          <!-- Hero Section - Rojo para urgencia -->
          <tr>
            <td style="padding: 0 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #dc2626, #991b1b); border-radius: 8px;">
                <tr>
                  <td align="center" style="padding: 40px 20px;">
                    <h1 class="hero-title" style="color: white; margin: 0 0 15px 0; font-size: 28px; font-weight: 700;">ALERTA: Caducidad por Inactividad</h1>
                    <p class="hero-subtitle" style="color: white; margin: 0; font-size: 18px;">Requiere intervención inmediata</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 30px;">
              <p class="content-text" style="font-size: 17px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola {{userName}},
              </p>
              <p class="content-text" style="font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                <strong>Tienes {{foldersCount}} carpeta(s) que requieren atención urgente</strong> por riesgo de caducidad debido a inactividad procesal.
              </p>
              <p class="content-text" style="font-size: 15px; line-height: 1.6; margin: 0 0 20px 0; padding: 15px; background-color: #fef2f2; border-left: 4px solid #dc2626; border-radius: 4px;">
                La caducidad de instancia se produce cuando transcurren <strong>{{caducityDays}} días</strong> sin actividad procesal. Es fundamental realizar alguna actuación para evitar la pérdida del proceso.
              </p>
            </td>
          </tr>

          <!-- Folders Table -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; border-radius: 8px;">
                <tr>
                  <td style="padding: 25px;">
                    {{foldersTableHtml}}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Call to Action -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <p class="content-text" style="font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Te recomendamos acceder a tu cuenta y realizar las gestiones necesarias para impulsar estos procesos.
              </p>
              <p class="content-text" style="font-size: 16px; line-height: 1.6; margin: 0;">
                Saludos,<br>El equipo de Law||Analytics
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 0 30px;">
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding: 0 30px 30px 30px; font-size: 13px; color: #6b7280;">
              <p style="margin: 8px 0;">¿Preguntas? Escríbenos a <a href="mailto:soporte@lawanalytics.app" style="color: #3b82f6; text-decoration: none;">soporte@lawanalytics.app</a></p>
              <p style="margin: 8px 0;">© 2025 Law||Analytics - Transformando la práctica legal</p>
              <p style="margin: 8px 0;">
                <a href="{{process.env.BASE_URL}}/privacy-policy" style="color: #3b82f6; text-decoration: none; margin: 0 10px;">Privacidad</a>
                <a href="{{process.env.BASE_URL}}/terms" style="color: #3b82f6; text-decoration: none; margin: 0 10px;">Términos</a>
                <a href="{{process.env.BASE_URL}}/unsubscribe?email={{userEmail}}" style="color: #6b7280; text-decoration: none; margin: 0 10px;">Cancelar suscripción</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const caducityText = `ALERTA: Caducidad por Inactividad - Law||Analytics

Hola {{userName}},

Tienes {{foldersCount}} carpeta(s) que requieren atención urgente por riesgo de caducidad debido a inactividad procesal.

La caducidad de instancia se produce cuando transcurren {{caducityDays}} días sin actividad procesal.

CARPETAS CON ALERTA DE CADUCIDAD:
{{foldersListText}}

Te recomendamos acceder a tu cuenta y realizar las gestiones necesarias para impulsar estos procesos.

Saludos,
El equipo de Law||Analytics

---
© 2025 Law||Analytics
soporte@lawanalytics.app`;

    const caducityTemplate = {
      category: 'notification',
      name: 'folder-caducity',
      description: 'Notificación de alerta de caducidad por inactividad en carpetas',
      subject: 'Law||Analytics: ALERTA - {{foldersCount}} carpeta(s) próxima(s) a caducidad por inactividad',
      htmlContent: caducityHtml,
      textContent: caducityText,
      isActive: true,
      version: 1
    };

    // =====================================================
    // Template 2: folder-prescription (Alerta de Prescripción)
    // =====================================================
    const prescriptionHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Law||Analytics: Alerta de Prescripción</title>
  <style>
    @media screen and (max-width: 600px) {
      .container { width: 100% !important; padding: 10px !important; }
      .hero-title { font-size: 22px !important; }
      .hero-subtitle { font-size: 16px !important; }
      .content-text { font-size: 15px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #333; background-color: #f5f7fa;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f7fa;">
    <tr>
      <td align="center" style="padding: 30px;">
        <table class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 10px;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding: 25px;">
              <img src="https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png" alt="Law||Analytics Logo" style="max-width: 200px; height: auto;">
            </td>
          </tr>

          <!-- Hero Section - Amarillo/Naranja para alerta -->
          <tr>
            <td style="padding: 0 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #f59e0b, #d97706); border-radius: 8px;">
                <tr>
                  <td align="center" style="padding: 40px 20px;">
                    <h1 class="hero-title" style="color: white; margin: 0 0 15px 0; font-size: 28px; font-weight: 700;">ALERTA: Prescripción por Inactividad</h1>
                    <p class="hero-subtitle" style="color: white; margin: 0; font-size: 18px;">Acción preventiva recomendada</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 30px;">
              <p class="content-text" style="font-size: 17px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola {{userName}},
              </p>
              <p class="content-text" style="font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                <strong>Tienes {{foldersCount}} carpeta(s) con riesgo de prescripción</strong> debido al tiempo transcurrido sin actividad.
              </p>
              <p class="content-text" style="font-size: 15px; line-height: 1.6; margin: 0 0 20px 0; padding: 15px; background-color: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 4px;">
                La prescripción puede ocurrir cuando transcurren <strong>{{prescriptionDays}} días</strong> sin actividad procesal. Revisar estos expedientes puede prevenir la pérdida de derechos.
              </p>
            </td>
          </tr>

          <!-- Folders Table -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; border-radius: 8px;">
                <tr>
                  <td style="padding: 25px;">
                    {{foldersTableHtml}}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Call to Action -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <p class="content-text" style="font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Te recomendamos revisar el estado de estos expedientes y evaluar si es necesario realizar alguna gestión.
              </p>
              <p class="content-text" style="font-size: 16px; line-height: 1.6; margin: 0;">
                Saludos,<br>El equipo de Law||Analytics
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 0 30px;">
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding: 0 30px 30px 30px; font-size: 13px; color: #6b7280;">
              <p style="margin: 8px 0;">¿Preguntas? Escríbenos a <a href="mailto:soporte@lawanalytics.app" style="color: #3b82f6; text-decoration: none;">soporte@lawanalytics.app</a></p>
              <p style="margin: 8px 0;">© 2025 Law||Analytics - Transformando la práctica legal</p>
              <p style="margin: 8px 0;">
                <a href="{{process.env.BASE_URL}}/privacy-policy" style="color: #3b82f6; text-decoration: none; margin: 0 10px;">Privacidad</a>
                <a href="{{process.env.BASE_URL}}/terms" style="color: #3b82f6; text-decoration: none; margin: 0 10px;">Términos</a>
                <a href="{{process.env.BASE_URL}}/unsubscribe?email={{userEmail}}" style="color: #6b7280; text-decoration: none; margin: 0 10px;">Cancelar suscripción</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const prescriptionText = `ALERTA: Prescripción por Inactividad - Law||Analytics

Hola {{userName}},

Tienes {{foldersCount}} carpeta(s) con riesgo de prescripción debido al tiempo transcurrido sin actividad.

La prescripción puede ocurrir cuando transcurren {{prescriptionDays}} días sin actividad procesal.

CARPETAS CON ALERTA DE PRESCRIPCIÓN:
{{foldersListText}}

Te recomendamos revisar el estado de estos expedientes y evaluar si es necesario realizar alguna gestión.

Saludos,
El equipo de Law||Analytics

---
© 2025 Law||Analytics
soporte@lawanalytics.app`;

    const prescriptionTemplate = {
      category: 'notification',
      name: 'folder-prescription',
      description: 'Notificación de alerta de prescripción por inactividad en carpetas',
      subject: 'Law||Analytics: ALERTA - {{foldersCount}} carpeta(s) con riesgo de prescripción',
      htmlContent: prescriptionHtml,
      textContent: prescriptionText,
      isActive: true,
      version: 1
    };

    // =====================================================
    // Template 3: folder-inactivity-report (Reporte Admin)
    // =====================================================
    const reportHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Law||Analytics: Reporte de Notificaciones de Inactividad</title>
  <style>
    @media screen and (max-width: 600px) {
      .container { width: 100% !important; padding: 10px !important; }
      .hero-title { font-size: 22px !important; }
      .content-text { font-size: 15px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #333; background-color: #f5f7fa;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f7fa;">
    <tr>
      <td align="center" style="padding: 30px;">
        <table class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 10px;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding: 25px;">
              <img src="https://res.cloudinary.com/dqyoeolib/image/upload/v1746261520/gzemrcj26etf5n6t1dmw.png" alt="Law||Analytics Logo" style="max-width: 200px; height: auto;">
            </td>
          </tr>

          <!-- Hero Section -->
          <tr>
            <td style="padding: 0 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #6366f1, #4f46e5); border-radius: 8px;">
                <tr>
                  <td align="center" style="padding: 40px 20px;">
                    <h1 class="hero-title" style="color: white; margin: 0 0 15px 0; font-size: 28px; font-weight: 700;">Reporte de Notificaciones</h1>
                    <p style="color: white; margin: 0; font-size: 18px;">Inactividad de Carpetas</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 30px;">
              <p class="content-text" style="font-size: 17px; line-height: 1.6; margin: 0 0 20px 0;">
                Resumen del trabajo de notificaciones de inactividad ejecutado el <strong>{{timestamp}}</strong>:
              </p>
            </td>
          </tr>

          <!-- Stats Table -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; border-radius: 8px;">
                <tr>
                  <td style="padding: 25px;">
                    <table width="100%" cellpadding="10" cellspacing="0" border="0">
                      <tr>
                        <td style="border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #374151;">Usuarios procesados:</td>
                        <td style="border-bottom: 1px solid #e5e7eb; text-align: right; color: #4b5563;">{{usersProcessed}}</td>
                      </tr>
                      <tr>
                        <td style="border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #374151;">Usuarios notificados:</td>
                        <td style="border-bottom: 1px solid #e5e7eb; text-align: right; color: #4b5563;">{{usersNotified}}</td>
                      </tr>
                      <tr>
                        <td style="border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #dc2626;">Notificaciones de caducidad:</td>
                        <td style="border-bottom: 1px solid #e5e7eb; text-align: right; color: #dc2626; font-weight: 600;">{{caducityNotifications}}</td>
                      </tr>
                      <tr>
                        <td style="border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #f59e0b;">Notificaciones de prescripción:</td>
                        <td style="border-bottom: 1px solid #e5e7eb; text-align: right; color: #f59e0b; font-weight: 600;">{{prescriptionNotifications}}</td>
                      </tr>
                      <tr>
                        <td style="font-weight: 700; color: #374151; padding-top: 15px;">TOTAL NOTIFICACIONES:</td>
                        <td style="text-align: right; font-weight: 700; color: #1f2937; padding-top: 15px; font-size: 18px;">{{totalNotifications}}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 0 30px;">
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding: 0 30px 30px 30px; font-size: 13px; color: #6b7280;">
              <p style="margin: 8px 0;">Este es un reporte automático del sistema de notificaciones.</p>
              <p style="margin: 8px 0;">© 2025 Law||Analytics - Transformando la práctica legal</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const reportText = `Reporte de Notificaciones de Inactividad - Law||Analytics

Fecha y hora: {{timestamp}}

RESUMEN:
- Usuarios procesados: {{usersProcessed}}
- Usuarios notificados: {{usersNotified}}
- Notificaciones de caducidad enviadas: {{caducityNotifications}}
- Notificaciones de prescripción enviadas: {{prescriptionNotifications}}
- TOTAL NOTIFICACIONES: {{totalNotifications}}

---
Este es un reporte automático del sistema de notificaciones.
© 2025 Law||Analytics`;

    const reportTemplate = {
      category: 'administration',
      name: 'folder-inactivity-report',
      description: 'Reporte de resumen de notificaciones de inactividad para administradores',
      subject: 'Law||Analytics: Reporte de Notificaciones de Inactividad - {{totalNotifications}} enviadas',
      htmlContent: reportHtml,
      textContent: reportText,
      isActive: true,
      version: 1
    };

    // Crear o actualizar templates
    const templates = [
      { data: caducityTemplate, name: 'folder-caducity' },
      { data: prescriptionTemplate, name: 'folder-prescription' },
      { data: reportTemplate, name: 'folder-inactivity-report' }
    ];

    for (const template of templates) {
      const existing = await EmailTemplate.findOne({
        category: template.data.category,
        name: template.data.name
      });

      if (existing) {
        await EmailTemplate.updateOne({ _id: existing._id }, template.data);
        console.log(`Template ${template.name} actualizado`);
      } else {
        await EmailTemplate.create(template.data);
        console.log(`Template ${template.name} creado`);
      }
    }

    console.log('\nTodos los templates fueron procesados exitosamente!');

    await mongoose.disconnect();
    console.log('Desconectado de MongoDB');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

createTemplates();
