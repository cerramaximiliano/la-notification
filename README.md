# Notification Law||Analytics App

Aplicación para el envío automatizado de notificaciones a usuarios mediante tareas programadas (cron jobs). Esta aplicación envía recordatorios por correo electrónico sobre eventos, tareas y movimientos próximos a vencer o expirar.

## Características

- Notificaciones automáticas de eventos de calendario
- Notificaciones automáticas de tareas por vencer
- Notificaciones automáticas de movimientos próximos a expirar
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
│   └── websocket.js       # Servicio de WebSocket para notificaciones push
├── cron/                  # Definición de trabajos cron
│   └── notificationJobs.js # Implementación de trabajos
├── client-example.js      # Ejemplo de cliente WebSocket para pruebas
└── models/                # Modelos de datos (debes agregarlos)
    ├── User.js            # Modelo de usuario
    ├── Event.js           # Modelo de evento
    ├── Task.js            # Modelo de tarea
    ├── Movement.js        # Modelo de movimiento
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