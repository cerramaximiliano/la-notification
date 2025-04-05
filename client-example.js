// Ejemplo de cliente WebSocket para probar notificaciones push
// Este es un ejemplo que se podría adaptar para su uso en el cliente real (navegador)

const io = require('socket.io-client');

// Configuración del cliente
const serverUrl = 'http://localhost:3004'; // URL del servidor WebSocket
const userId = '645f83106fb57dc9a99b9f29'; // ID del usuario para pruebas

// Conectar al servidor WebSocket
const socket = io(serverUrl);

// Manejar eventos
socket.on('connect', () => {
    console.log('Conectado al servidor WebSocket');
    console.log('ID de socket:', socket.id);
    
    // Autenticar con el ID de usuario
    socket.emit('authenticate', userId);
    console.log('Enviada solicitud de autenticación para usuario:', userId);
});

// Manejar confirmación de autenticación
socket.on('authenticated', (data) => {
    console.log('Autenticación exitosa:', data);
});

// Manejar errores de autenticación
socket.on('authentication_error', (error) => {
    console.error('Error de autenticación:', error);
});

// Escuchar alertas pendientes (recibidas al conectarse)
socket.on('pending_alerts', (alerts) => {
    console.log('Recibidas alertas pendientes:', alerts.length);
    alerts.forEach((alert, index) => {
        console.log(`Alerta pendiente ${index + 1}:`, {
            primaryText: alert.primaryText,
            secondaryText: alert.secondaryText,
            createdAt: alert.createdAt
        });
    });
});

// Escuchar nuevas alertas
socket.on('new_alert', (alert) => {
    console.log('Nueva alerta recibida:');
    console.log({
        primaryText: alert.primaryText,
        secondaryText: alert.secondaryText,
        createdAt: alert.createdAt
    });
    
    // Aquí se podría mostrar una notificación al usuario en la interfaz
    // o utilizar las APIs de notificaciones del navegador
    // Por ejemplo:
    /*
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(alert.primaryText, {
            body: alert.secondaryText,
            icon: '/path/to/icon.png'
        });
    }
    */
});

// Manejar desconexión
socket.on('disconnect', () => {
    console.log('Desconectado del servidor WebSocket');
});

// Manejar errores
socket.on('error', (error) => {
    console.error('Error en la conexión WebSocket:', error);
});

// Mantener el script en ejecución
console.log('Cliente WebSocket iniciado. Presiona Ctrl+C para detener.');

// Función para simular la creación de una alerta (para pruebas)
// Esta función no es necesaria en el cliente real
function simulateAlert() {
    console.log('Simulando creación de alerta en el servidor...');
    // Esta simulación requeriría un endpoint en el servidor
}

// Manejar cierre limpio
process.on('SIGINT', () => {
    console.log('Cerrando cliente WebSocket...');
    socket.close();
    process.exit(0);
});