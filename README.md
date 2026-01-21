# Notification Law||Analytics App

Aplicación para el envío automatizado de notificaciones a usuarios mediante tareas programadas (cron jobs). Esta aplicación envía recordatorios por correo electrónico sobre eventos, tareas y movimientos próximos a vencer o expirar.

## Características

- Notificaciones automáticas de eventos de calendario
- Notificaciones automáticas de tareas por vencer
- Notificaciones automáticas de movimientos próximos a expirar
- **Notificaciones de movimientos judiciales** con sistema de coordinación
- Notificaciones de inactividad de carpetas (caducidad y prescripción)
- Notificaciones push en tiempo real mediante WebSockets
- Configuración personalizada por usuario
- Respeta las preferencias de notificación de cada usuario
- Log detallado de todas las operaciones

## Requisitos previos

- Node.js (v14 o superior)
- MongoDB (v4.2 o superior)
- Servidor SMTP para envío de correos electrónicos

## Instalación

1. Clona este repositorio:
   ```bash
   git clone https://github.com/tu-usuario/notification-cron-app.git
   cd notification-cron-app
   ```

2. Instala las dependencias:
   ```bash
   npm install
   ```

3. Crea el archivo `.env` basado en `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Edita el archivo `.env` con tus configuraciones:
   ```
   # Configuración de MongoDB
   MONGODB_URI=mongodb://localhost:27017/tu_basedatos

   # Servidor de correo
   EMAIL_HOST=smtp.example.com
   EMAIL_PORT=587
   EMAIL_USER=tu_correo@example.com
   EMAIL_PASS=tu_contraseña
   EMAIL_FROM=notificaciones@tuaplicacion.com

   # Horarios de ejecución (expresiones cron)
   NOTIFICATION_CALENDAR_CRON=0 8 * * *
   NOTIFICATION_TASK_CRON=0 9 * * *
   NOTIFICATION_MOVEMENT_CRON=0 10 * * *

   # Configuración por defecto
   DEFAULT_DAYS_IN_ADVANCE=5
   
   # Puerto para el servidor
   PORT_NOTIFICATIONS=3004
   ```

5. Agrega tus modelos en la carpeta `models/`:
   - User.js
   - Event.js
   - Task.js
   - Movement.js

## Uso

### Iniciar la aplicación

```bash
npm start
```

Para desarrollo con recarga automática:

```bash
npm run dev
```

### Estructura de la aplicación

```
notification-cron-app/
├── app.js                 # Punto de entrada
├── config/                # Configuraciones
│   ├── db.js              # Conexión a la base de datos
│   ├── logger.js          # Configuración de logging
│   └── cron.js            # Configuración de tareas programadas
├── services/              # Servicios de la aplicación
│   ├── notifications.js   # Lógica de notificaciones
│   ├── email.js           # Servicio de correo electrónico
│   ├── websocket.js       # Servicio de WebSocket para notificaciones push
│   └── judicialMovementCoordinator.js  # Coordinador de movimientos judiciales
├── cron/                  # Definición de trabajos cron
│   └── notificationJobs.js # Implementación de trabajos
├── scripts/               # Scripts de utilidad
│   ├── coordinateJudicialNotifications.js  # Coordinación manual
│   └── testJudicialMovementJob.js          # Prueba del job completo
├── client-example.js      # Ejemplo de cliente WebSocket para pruebas
└── models/                # Modelos de datos
    ├── User.js            # Modelo de usuario
    ├── Event.js           # Modelo de evento
    ├── Task.js            # Modelo de tarea
    ├── Movement.js        # Modelo de movimiento
    ├── JudicialMovement.js # Modelo de movimientos judiciales
    ├── Folder.js          # Modelo de carpetas (vincula usuarios con causas)
    └── Alert.js           # Modelo de alertas y notificaciones
```

## Configuración de tareas programadas

Las tareas programadas se definen mediante expresiones cron en el archivo `.env`:

- `NOTIFICATION_CALENDAR_CRON`: Por defecto se ejecuta a las 8:00 AM todos los días
- `NOTIFICATION_TASK_CRON`: Por defecto se ejecuta a las 9:00 AM todos los días
- `NOTIFICATION_MOVEMENT_CRON`: Por defecto se ejecuta a las 10:00 AM todos los días

### Formato de expresiones cron

```
┌─────────────── minutos (0 - 59)
│ ┌───────────── horas (0 - 23)
│ │ ┌─────────── día del mes (1 - 31)
│ │ │ ┌───────── mes (1 - 12)
│ │ │ │ ┌─────── día de la semana (0 - 6) (Domingo a Sábado)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

Ejemplos:
- `0 8 * * *`: Todos los días a las 8:00 AM
- `0 */2 * * *`: Cada 2 horas, en el minuto 0
- `0 8-17 * * 1-5`: De lunes a viernes, cada hora desde las 8:00 AM hasta las 5:00 PM

## Notificaciones Push con WebSockets

La aplicación incluye un sistema de notificaciones push en tiempo real usando WebSockets con socket.io.

### Funcionamiento

1. El servidor mantiene una conexión WebSocket con los clientes conectados
2. Cuando se crea una nueva alerta, se envía automáticamente a los clientes conectados
3. Si un cliente no está conectado, las alertas quedan pendientes y se envían cuando el cliente se conecta
4. Las alertas se entregan solo una vez

### Uso en el cliente

#### Conectar al WebSocket:

```javascript
// En el navegador
const socket = io('http://tu-servidor:3004');

// Autenticar con el ID del usuario
socket.on('connect', () => {
  socket.emit('authenticate', userId);
});

// Escuchar nuevas alertas
socket.on('new_alert', (alert) => {
  console.log('Nueva alerta:', alert);
  // Mostrar notificación al usuario
});

// Recibir alertas pendientes al conectar
socket.on('pending_alerts', (alerts) => {
  console.log('Alertas pendientes:', alerts);
  // Procesar alertas pendientes
});
```

### Ejemplo

Se incluye un archivo `client-example.js` que muestra cómo implementar un cliente de prueba:

```bash
node client-example.js
```

## Notificaciones de Movimientos Judiciales

El sistema incluye un módulo especializado para notificar a los usuarios sobre nuevos movimientos en sus causas judiciales vinculadas.

### Arquitectura

El proceso de notificaciones judiciales consta de dos pasos que se ejecutan cada 15 minutos:

```
judicialMovementNotificationJob (cada 15 minutos)
│
├── PASO 1: COORDINACIÓN
│   ├── Buscar causas con fechaUltimoMovimiento = hoy
│   ├── Filtrar movimientos del array que coincidan con la fecha
│   ├── Obtener usuarios vinculados (vía colección Folders)
│   ├── Verificar si ya existe documento JudicialMovement (uniqueKey)
│   └── Crear documentos faltantes con notifyAt = 19:00 Argentina
│
└── PASO 2: NOTIFICACIÓN
    ├── Buscar JudicialMovement con status='pending' y notifyAt <= ahora
    ├── Agrupar por usuario
    ├── Enviar email con todos los movimientos del usuario
    └── Actualizar status a 'sent'
```

### Sistema de Coordinación

El coordinador (`services/judicialMovementCoordinator.js`) resuelve el problema de documentos JudicialMovement que no se crean debido a errores en el proceso original (webhook).

#### Funcionamiento

1. **Búsqueda de causas**: Consulta las 11 colecciones de causas buscando `fechaUltimoMovimiento` del día actual
2. **Filtrado de movimientos**: Para cada causa, filtra los movimientos cuya fecha coincida con el día
3. **Vinculación de usuarios**: Obtiene los usuarios asociados a cada causa mediante la colección `Folders`
4. **Deduplicación**: Genera un `uniqueKey` para evitar crear documentos duplicados
5. **Creación**: Crea documentos `JudicialMovement` con `notificationStatus: 'pending'` y `notifyAt: 19:00`

#### Colecciones de causas soportadas

| Modelo | Colección | Fuero |
|--------|-----------|-------|
| CausasCivil | causas-civil | Civil |
| CausasComercial | causas-comercial | Comercial |
| CausasSegSoc | causas-segsocial | Seguridad Social |
| CausasTrabajo | causas-trabajo | Trabajo |
| CausasCAF | causas_caf | Contencioso Administrativo Federal |
| CausasCCF | causas_ccf | Civil y Comercial Federal |
| CausasCNE | causas_cne | Electoral |
| CausasCPE | causas_cpe | Penal Económico |
| CausasCFP | causas_cfp | Criminal y Correccional Federal |
| CausasCCC | causas_ccc | Criminal y Correccional |
| CausasCSJ | causas_csj | Corte Suprema de Justicia |

#### Múltiples movimientos

El sistema maneja correctamente múltiples movimientos del mismo día. Si una causa tiene 3 movimientos en la fecha y está vinculada a 2 usuarios, se crean 6 documentos JudicialMovement (uno por cada combinación usuario-movimiento).

### Configuración

Variables de entorno:
```env
# Frecuencia del job (default: cada 15 minutos)
NOTIFICATION_JUDICIAL_MOVEMENT_CRON=*/15 * * * *

# Horas para enviar reportes de monitoreo al admin (default: 15:00, 17:00, 19:30)
JUDICIAL_MOVEMENT_REPORT_HOURS=15:00,17:00,19:30
```

**Nota:** Los reportes de monitoreo también se envían inmediatamente si hay errores, independientemente de la hora.

### Modelo JudicialMovement

```javascript
{
  userId: ObjectId,           // Usuario a notificar
  expediente: {
    id: String,               // ID de la causa
    number: Number,           // Número de expediente
    year: Number,             // Año
    fuero: String,            // Fuero (CIV, COM, etc.)
    caratula: String,         // Carátula
    objeto: String            // Objeto del juicio
  },
  movimiento: {
    fecha: Date,              // Fecha del movimiento
    tipo: String,             // Tipo (ESCRITO, MOVIMIENTO, etc.)
    detalle: String,          // Descripción
    url: String               // URL al documento (opcional)
  },
  notificationSettings: {
    notifyAt: Date,           // Hora programada (19:00 Argentina)
    channels: ['email', 'browser']
  },
  notificationStatus: String, // 'pending' | 'sent' | 'failed'
  uniqueKey: String           // Hash para deduplicación
}
```

### Scripts de utilidad

#### Coordinación manual
```bash
# Ejecutar coordinación para hoy (solo muestra, no crea)
node scripts/coordinateJudicialNotifications.js --dry-run

# Ejecutar coordinación y crear documentos
node scripts/coordinateJudicialNotifications.js

# Coordinación para una fecha específica
node scripts/coordinateJudicialNotifications.js --date 2026-01-20

# Modo verbose
node scripts/coordinateJudicialNotifications.js --verbose
```

#### Prueba del job completo
```bash
node scripts/testJudicialMovementJob.js
```

### Limitaciones conocidas

| Escenario | Descripción |
|-----------|-------------|
| MongoDB caído | Si la BD no está disponible, coordinación y notificación fallan |
| Causa sin Folder | Si nadie tiene la causa vinculada, no hay a quién notificar |
| Email fallido | Errores de SES, email inválido, cuota excedida |
| Nueva colección | Tipos de causa no listados en `CAUSA_COLLECTIONS` no se coordinan |
| Ventana de 15 min | Movimientos que llegan entre ejecuciones se notifican en la siguiente |

### Sistema de Alertas de Monitoreo

El sistema envía reportes de monitoreo al administrador con estadísticas de cada ejecución.

#### Horarios de reportes

Los reportes se envían en horarios específicos para evitar saturar el email:

```env
# Default: 15:00, 17:00 y 19:30 horas Argentina
JUDICIAL_MOVEMENT_REPORT_HOURS=15:00,17:00,19:30
```

**Excepción:** Si ocurren errores durante la ejecución, el reporte se envía inmediatamente independientemente de la hora.

#### Contenido del reporte

El reporte incluye:

| Sección | Métricas |
|---------|----------|
| **Estado** | ✅ Exitoso / ⚠️ Advertencias / ❌ Errores |
| **Coordinación** | Causas encontradas, movimientos del día, usuarios vinculados, documentos creados, existentes, errores |
| **Notificación** | Usuarios pendientes, emails enviados, exitosos, fallidos |
| **Resumen** | Total documentos creados, total emails enviados, total errores |

#### Template de email

El template se almacena en la base de datos:
- **Categoría:** `administration`
- **Nombre:** `judicial-movement-report`

Para crear/actualizar el template:
```bash
node scripts/createJudicialMovementReportTemplate.js
```

## Logs

Los logs se guardan en la carpeta `logs/`:
- `combined.log`: Todos los logs
- `error.log`: Solo los logs de error

## Contribuir

1. Haz un fork del repositorio
2. Crea una rama para tu funcionalidad (`git checkout -b feature/amazing-feature`)
3. Haz commit de tus cambios (`git commit -m 'Añadir nueva funcionalidad'`)
4. Haz push a la rama (`git push origin feature/amazing-feature`)
5. Abre un Pull Request

## Licencia

Este proyecto está licenciado bajo [tu licencia] - ver el archivo LICENSE para más detalles.