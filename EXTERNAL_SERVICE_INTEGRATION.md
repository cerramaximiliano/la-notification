# Guía de Integración para Servicios Externos

## Resumen
Este documento describe las reglas y requisitos para que microservicios externos puedan enviar notificaciones a través del servicio de notificaciones de Law||Analytics.

## Arquitectura General

El servicio de notificaciones actúa como un hub centralizado que:
- Recibe datos de entidades externas mediante webhooks
- Almacena la información necesaria para generar notificaciones
- Procesa las notificaciones según horarios configurados
- Mantiene un registro completo de todas las notificaciones enviadas

## Reglas de Integración

### 1. Autenticación

Los servicios externos deben autenticarse usando un token Bearer:

```bash
Authorization: Bearer ${INTERNAL_SERVICE_TOKEN}
```

**Requisitos:**
- El token debe ser compartido de forma segura entre servicios
- Cada servicio externo puede tener su propio token (recomendado)
- Los tokens deben almacenarse en variables de entorno

### 2. Formato de Datos

#### Estructura del Webhook

```javascript
POST /api/judicial-movements/webhook/daily-movements
Content-Type: application/json

{
  "notificationTime": "2025-01-21T13:00:00Z", // ISO 8601, opcional
  "movements": [
    {
      "userId": "string", // ID del usuario en MongoDB
      "expediente": {
        "id": "string",     // ID único del expediente
        "number": number,   // Número del expediente
        "year": number,     // Año del expediente
        "fuero": "string",  // Jurisdicción
        "caratula": "string", // Título completo
        "objeto": "string"  // Tipo de proceso (opcional)
      },
      "movimiento": {
        "fecha": "2025-01-21T00:00:00.000Z", // ISO 8601
        "tipo": "string",    // Tipo de movimiento
        "detalle": "string", // Descripción detallada
        "url": "string"      // URL del documento (opcional)
      }
    }
  ]
}
```

#### Campos Obligatorios

- `userId`: Debe corresponder a un usuario válido en el sistema
- `expediente.id`: Identificador único del expediente
- `expediente.number` y `expediente.year`: Para identificación visual
- `expediente.fuero`: Jurisdicción del expediente
- `expediente.caratula`: Título descriptivo del caso
- `movimiento.fecha`: Fecha del movimiento (formato ISO 8601)
- `movimiento.tipo`: Categoría del movimiento
- `movimiento.detalle`: Descripción del movimiento

### 3. Reglas de Negocio

#### Prevención de Duplicados

El sistema genera una clave única basada en:
```
${userId}_${expedienteId}_${movimientoFecha}_${movimientoTipo}
```

**Implicaciones:**
- El mismo movimiento no se notificará dos veces
- Si se reenvía un movimiento existente, se actualizará la información
- Los movimientos se consideran únicos por usuario

#### Horarios de Notificación

- **Por defecto**: 9:00 AM (hora local del servidor)
- **Personalizable**: Mediante el campo `notificationTime`
- **Procesamiento**: Cada hora mediante cron job

#### Agrupación de Notificaciones

- Los movimientos del mismo expediente se agrupan en un solo email
- Múltiples expedientes generan secciones separadas en el email
- Se mantiene el orden cronológico dentro de cada expediente

### 4. Manejo de Errores

#### Códigos de Respuesta

- `200 OK`: Movimientos procesados correctamente
- `400 Bad Request`: Datos inválidos o faltantes
- `401 Unauthorized`: Token inválido o faltante
- `500 Internal Server Error`: Error del servidor

#### Respuesta de Éxito

```json
{
  "success": true,
  "results": {
    "received": 5,      // Total de movimientos recibidos
    "created": 4,       // Movimientos creados/actualizados
    "duplicates": 1,    // Movimientos duplicados (ignorados)
    "errors": []        // Array de errores específicos
  }
}
```

#### Respuesta de Error

```json
{
  "success": false,
  "message": "Descripción del error",
  "error": "Detalle técnico del error"
}
```

### 5. Limpieza de Datos

- Los movimientos notificados se mantienen por 30 días
- Después de 30 días, los movimientos con estado 'sent' se eliminan automáticamente
- Los movimientos fallidos se mantienen para análisis

### 6. Configuración del Usuario

Para que las notificaciones se envíen, el usuario debe tener:

```javascript
user.preferences.notifications.channels.email !== false
```

Si el usuario tiene deshabilitadas las notificaciones por email, el movimiento se marcará como procesado pero no se enviará.

## Implementación Paso a Paso

### 1. Obtener Token de Autenticación

Solicitar al administrador del sistema un token de servicio interno.

### 2. Identificar Movimientos del Día

```javascript
// En tu servicio
const today = new Date();
today.setHours(0, 0, 0, 0);

const movements = await Expediente.aggregate([
  { $unwind: "$movimiento" },
  {
    $match: {
      "movimiento.fecha": {
        $gte: today,
        $lt: new Date(today.getTime() + 24*60*60*1000)
      }
    }
  }
]);
```

### 3. Formatear y Enviar

```javascript
const axios = require('axios');

async function sendDailyMovements(movements) {
  const payload = {
    notificationTime: new Date().setHours(13, 0, 0, 0), // 1:00 PM
    movements: movements.map(m => ({
      userId: m.userCausaIds[0],
      expediente: {
        id: m._id,
        number: m.number,
        year: m.year,
        fuero: m.fuero,
        caratula: m.caratula,
        objeto: m.objeto
      },
      movimiento: m.movimiento
    }))
  };

  try {
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/api/judicial-movements/webhook/daily-movements`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${INTERNAL_SERVICE_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Movimientos enviados:', response.data);
  } catch (error) {
    console.error('Error enviando movimientos:', error.response?.data || error.message);
  }
}
```

### 4. Programar Envío Diario

```javascript
// Usando node-cron
const cron = require('node-cron');

// Ejecutar todos los días a las 8:00 AM
cron.schedule('0 8 * * *', async () => {
  console.log('Enviando movimientos del día al servicio de notificaciones');
  const movements = await getMovimientosDelDia();
  await sendDailyMovements(movements);
});
```

## Consideraciones de Seguridad

1. **Tokens**: Rotar periódicamente los tokens de servicio
2. **HTTPS**: Usar siempre conexiones seguras
3. **Validación**: Validar todos los datos antes de enviar
4. **Rate Limiting**: Implementar límites para evitar sobrecarga
5. **Logs**: Mantener registros de todas las transacciones

## Monitoreo

### Endpoints de Consulta

```bash
# Consultar movimientos pendientes de un usuario
GET /api/judicial-movements/pending/${userId}
Authorization: Bearer ${USER_TOKEN}

# Marcar movimiento como notificado manualmente
POST /api/judicial-movements/${movementId}/mark-notified
Authorization: Bearer ${USER_TOKEN}
```

### Logs del Sistema

El servicio registra:
- Recepción de webhooks
- Procesamiento de notificaciones
- Envío de emails
- Errores y excepciones

## Ejemplo Completo

```javascript
// servicio-expedientes/notificationSync.js
const axios = require('axios');
const mongoose = require('mongoose');
const cron = require('node-cron');

class NotificationSync {
  constructor() {
    this.notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL;
    this.serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
  }

  async syncTodayMovements() {
    try {
      // 1. Obtener movimientos del día
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const expedientes = await Expediente.find({
        'movimiento.fecha': {
          $gte: today,
          $lt: new Date(today.getTime() + 24*60*60*1000)
        },
        'userUpdatesEnabled.enabled': true
      });

      // 2. Formatear movimientos
      const movements = [];
      
      for (const exp of expedientes) {
        const todayMovements = exp.movimiento.filter(m => {
          const movDate = new Date(m.fecha);
          return movDate >= today && movDate < new Date(today.getTime() + 24*60*60*1000);
        });

        for (const mov of todayMovements) {
          for (const userUpdate of exp.userUpdatesEnabled) {
            if (userUpdate.enabled) {
              movements.push({
                userId: userUpdate.userId,
                expediente: {
                  id: exp._id.toString(),
                  number: exp.number,
                  year: exp.year,
                  fuero: exp.fuero,
                  caratula: exp.caratula,
                  objeto: exp.objeto
                },
                movimiento: {
                  fecha: mov.fecha,
                  tipo: mov.tipo,
                  detalle: mov.detalle,
                  url: mov.url
                }
              });
            }
          }
        }
      }

      // 3. Enviar al servicio de notificaciones
      if (movements.length > 0) {
        const response = await axios.post(
          `${this.notificationServiceUrl}/api/judicial-movements/webhook/daily-movements`,
          {
            notificationTime: new Date().setHours(13, 0, 0, 0),
            movements: movements
          },
          {
            headers: {
              'Authorization': `Bearer ${this.serviceToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log(`Sincronización exitosa: ${response.data.results.created} movimientos enviados`);
        return response.data;
      }

      console.log('No hay movimientos nuevos para sincronizar');
      return { success: true, results: { created: 0 } };

    } catch (error) {
      console.error('Error en sincronización:', error.message);
      throw error;
    }
  }
}

// Configurar cron job
const sync = new NotificationSync();
cron.schedule('0 8 * * *', () => {
  sync.syncTodayMovements()
    .then(result => console.log('Sincronización completada:', result))
    .catch(error => console.error('Error en cron:', error));
});

module.exports = NotificationSync;
```

## Soporte

Para dudas o problemas de integración:
- Email: soporte@lawanalytics.app
- Logs: Revisar `/logs/notification-service.log`
- Documentación API: `/api-docs`