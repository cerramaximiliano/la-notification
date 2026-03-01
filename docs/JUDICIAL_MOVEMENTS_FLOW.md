# Sistema de Notificaciones de Movimientos Judiciales

## Descripción General

El sistema de notificaciones de movimientos judiciales es un servicio que recibe información sobre movimientos procesales desde un microservicio externo y notifica a los usuarios afectados en horarios programados.

## Flujo Completo del Sistema

### 1. Recepción del Webhook

**Endpoint**: `POST /api/judicial-movements/webhook/daily-movements`

#### Autenticación
- Requiere token Bearer en el header `Authorization`
- Validado mediante `authMiddleware.verifyServiceToken`

#### Estructura del Request

```json
{
  "notificationTime": "2025-01-21T13:00:00Z",  // Opcional - ISO 8601
  "movements": [
    {
      "userId": "ObjectId del usuario",
      "expediente": {
        "id": "ID único del expediente",
        "number": 12345,
        "year": 2025,
        "fuero": "Jurisdicción",
        "caratula": "Título del caso",
        "objeto": "Tipo de proceso"  // Opcional
      },
      "movimiento": {
        "fecha": "2025-01-21T00:00:00.000Z",
        "tipo": "Tipo de movimiento",
        "detalle": "Descripción detallada",
        "url": "URL del documento"  // Opcional
      }
    }
  ]
}
```

### 2. Procesamiento Inicial

#### Generación de Clave Única
```javascript
uniqueKey = `${userId}_${expedienteId}_${fecha}_${tipo}`
```
- Previene duplicados usando `findOneAndUpdate` con `upsert: true`

#### Configuración de Hora de Notificación (`notifyAt`)

```javascript
// Si se proporciona notificationTime en el request
const notifyAt = notificationTime ? moment(notificationTime).toDate() : defaultTime;

// Si NO se proporciona, usa las 9:00 AM del día actual
const defaultTime = moment().hour(9).minute(0).second(0);
```

**Importante**: `notifyAt` define la **hora mínima** para enviar la notificación, no la hora exacta.

### 3. Almacenamiento en MongoDB

```javascript
JudicialMovement {
  userId: ObjectId,
  expediente: {
    id: String,
    number: Number,
    year: Number,
    fuero: String,
    caratula: String,
    objeto: String
  },
  movimiento: {
    fecha: Date,
    tipo: String,
    detalle: String,
    url: String
  },
  notificationStatus: 'pending',  // Estados: pending, sent, failed
  notificationSettings: {
    notifyAt: Date,  // Hora programada mínima
    channels: ['email', 'browser']
  },
  notifications: [],  // Historial de intentos
  uniqueKey: String,
  timestamps: true
}
```

### 4. Cron Job de Procesamiento

#### Configuración del Cron

- **Variable de entorno**: `NOTIFICATION_JUDICIAL_MOVEMENT_CRON`
- **Valor actual**: `*/30 * * * *` (cada 30 minutos)
- **Horarios de ejecución**: :00 y :30 de cada hora

#### Proceso del Cron Job

1. **Búsqueda de movimientos pendientes**:
```javascript
{
  notificationStatus: 'pending',
  'notificationSettings.notifyAt': { $lte: now }
}
```

2. **Agrupación por usuario**: Optimiza el envío consolidando múltiples movimientos

3. **Verificación de usuario**: Valida que el usuario existe en la BD

4. **Envío de notificaciones**: Llama a `sendJudicialMovementNotifications`

### 5. Proceso de Notificación

#### Verificaciones Previas
- Preferencias del usuario habilitadas
- Canales de notificación activos (email/browser)

#### Generación del Email
1. Agrupa movimientos por expediente
2. Usa templates de la base de datos
3. Procesa variables con `processJudicialMovementsData`
4. Envía mediante AWS SES

#### Actualización de Estado

```javascript
// Actualización masiva del estado
await JudicialMovement.updateMany(
  { _id: { $in: movementIds } },
  { $set: { notificationStatus: 'sent' } }
);

// Registro individual del historial
movement.notifications.push({
  date: new Date(),
  type: 'email',  // o 'browser'
  success: true,
  details: 'Descripción del resultado'
});
```

### 6. Notificaciones del Navegador

Si están habilitadas, se crean alertas en el sistema para mostrar en la UI del usuario.

### 7. Registro y Limpieza

- **NotificationLog**: Guarda registro detallado de cada notificación
- **Limpieza automática**: Elimina movimientos con estado 'sent' después de 30 días

## Temporización y Latencia

### Ejemplo de Flujo Temporal

| Hora | Evento |
|------|--------|
| 09:15 | Webhook recibe movimiento con `notifyAt = 10:15` |
| 10:00 | Cron ejecuta - No envía (aún no es hora) |
| 10:30 | Cron ejecuta - **SÍ envía** (ya pasó las 10:15) |

### Latencia del Sistema

Con la configuración actual (`*/30 * * * *`):
- **Latencia mínima**: 0 minutos (si notifyAt coincide con ejecución del cron)
- **Latencia máxima**: 30 minutos
- **Latencia promedio**: 15 minutos

### Optimización de Latencia

Para reducir la latencia, ajustar `NOTIFICATION_JUDICIAL_MOVEMENT_CRON`:
- `*/10 * * * *` - Cada 10 minutos (latencia máx: 10 min)
- `*/5 * * * *` - Cada 5 minutos (latencia máx: 5 min)
- `* * * * *` - Cada minuto (latencia máx: 1 min) ⚠️ Mayor carga

## Manejo de Errores

### Estados de Error

1. **Usuario no encontrado**: 
   - Estado cambia a `failed`
   - Se registra en `notifications` con `success: false`

2. **Error de envío de email**:
   - Estado cambia a `failed`
   - Se guarda el `failureReason`
   - Puede reintentarse manualmente

3. **Duplicados**:
   - Detectados por `uniqueKey`
   - No se procesan, se cuentan como duplicados

## Logs y Monitoreo

### Logs Típicos de Ejecución Exitosa

```
10:30:00 info: Ejecutando trabajo de notificaciones de movimientos judiciales
10:30:00 info: Se encontraron 2 usuarios con movimientos judiciales pendientes
10:30:01 info: Notificación enviada a usuario@email.com con 3 movimientos
10:30:01 info: Trabajo completado: 3 notificaciones enviadas
```

### Logs de Error

```
10:30:00 warn: Usuario 68c1a196f8de85c63ba999f0 no encontrado
10:30:01 error: Error enviando email: Connection timeout
```

## Configuración y Variables de Entorno

```bash
# Cron de movimientos judiciales (cada 30 minutos)
NOTIFICATION_JUDICIAL_MOVEMENT_CRON=*/30 * * * *

# Token de autenticación para servicios internos
INTERNAL_SERVICE_TOKEN=tu_token_seguro

# Email del administrador para reportes
ADMIN_EMAIL=admin@example.com

# Configuración de AWS SES
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=tu_access_key
AWS_SECRET_ACCESS_KEY=tu_secret_key
```

## Diagrama de Flujo

```
Microservicio Externo
        ↓
    POST /webhook
        ↓
Crear JudicialMovement
  (status: 'pending')
        ↓
    [Espera hasta notifyAt]
        ↓
  Cron Job (*/30 min)
        ↓
  Busca pendientes con
  notifyAt <= ahora
        ↓
  Agrupa por usuario
        ↓
  Verifica preferencias
        ↓
    ┌───────────┐
    ↓           ↓
  Email    Browser Alert
    ↓           ↓
    └───────────┘
        ↓
  Actualiza estado
  ('sent' o 'failed')
        ↓
  NotificationLog
        ↓
  Limpieza (30 días)
```

## Troubleshooting

### Problema: Notificaciones no se envían

**Verificar**:
1. Estado del movimiento (`notificationStatus`)
2. Hora programada (`notifyAt`)
3. Existencia del usuario en BD
4. Preferencias de notificación del usuario
5. Logs del cron job

### Problema: Latencia alta en notificaciones

**Solución**: Ajustar frecuencia del cron job en `NOTIFICATION_JUDICIAL_MOVEMENT_CRON`

### Problema: Duplicados

**Verificar**: 
- La generación de `uniqueKey`
- Que el microservicio no esté enviando duplicados

## Testing

### Script de Test Disponible

```bash
node tests/test-judicial-webhook.js
```

Simula el envío de movimientos judiciales y verifica:
- Autenticación
- Creación de registros
- Manejo de duplicados
- Estado en base de datos

## Mantenimiento

### Tareas Periódicas

1. **Monitorear logs** para detectar errores recurrentes
2. **Verificar limpieza automática** de movimientos antiguos
3. **Revisar latencia** y ajustar frecuencia del cron si es necesario
4. **Validar usuarios** que reciben notificaciones

### Métricas Importantes

- Total de movimientos procesados
- Tasa de éxito/fallo
- Latencia promedio de notificación
- Usuarios únicos notificados

---

*Última actualización: Septiembre 2025*
*Versión del sistema: 1.0.0*