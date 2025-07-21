#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const moment = require('moment');

// Cargar modelos en orden correcto
const User = require('../models/User');
const Alert = require('../models/Alert');
const Event = require('../models/Event');
const Task = require('../models/Task');
const Movement = require('../models/Movement');

async function connectDB() {
  try {
    await mongoose.connect(process.env.URLDB || 'mongodb://localhost:27017/la-notification');
    console.log('✅ Conectado a MongoDB');
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error);
    process.exit(1);
  }
}

async function analyzeAlerts() {
  await connectDB();
  
  try {
    console.log('\n🔍 Análisis detallado del sistema de alertas\n');
    
    // 1. Obtener la única alerta
    const alert = await Alert.findOne();
    
    if (!alert) {
      console.log('No hay alertas en la base de datos');
      return;
    }
    
    // Obtener información del usuario
    let userName = 'N/A';
    let userEmail = 'N/A';
    if (alert.userId) {
      const user = await User.findById(alert.userId).select('name email');
      if (user) {
        userName = user.name;
        userEmail = user.email;
      }
    }
    
    console.log('📋 Detalles de la alerta encontrada:');
    console.log('=====================================');
    console.log(`ID: ${alert._id}`);
    console.log(`Usuario: ${userName} (${userEmail})`);
    console.log(`Texto principal: ${alert.primaryText}`);
    console.log(`Texto secundario: ${alert.secondaryText}`);
    console.log(`Texto de acción: ${alert.actionText}`);
    console.log(`\nEstado:`);
    console.log(`  - Entregada (delivered): ${alert.delivered} ❌`);
    console.log(`  - Leída (read): ${alert.read} ✅`);
    console.log(`  - Intentos de entrega: ${alert.deliveryAttempts}`);
    console.log(`  - Último intento: ${alert.lastDeliveryAttempt || 'Nunca'}`);
    console.log(`\nFechas:`);
    console.log(`  - Creada: ${moment(alert.createdAt).format('DD/MM/YYYY HH:mm:ss')}`);
    console.log(`  - Actualizada: ${alert.updatedAt ? moment(alert.updatedAt).format('DD/MM/YYYY HH:mm:ss') : 'No tiene updatedAt'}`);
    
    // 2. Análisis de inconsistencia
    console.log('\n⚠️  INCONSISTENCIA DETECTADA:');
    console.log('La alerta está marcada como LEÍDA pero NO ENTREGADA.');
    console.log('Esto sugiere que:');
    console.log('1. La alerta fue leída por otro medio (no WebSocket)');
    console.log('2. Hubo un error en el proceso de actualización');
    console.log('3. La alerta fue modificada manualmente');
    
    // 3. Verificar notificaciones relacionadas
    console.log('\n🔄 Buscando notificaciones relacionadas en otros modelos...');
    
    // Buscar en eventos, tareas y movimientos del mismo usuario
    if (alert.userId) {
      const [events, tasks, movements] = await Promise.all([
        Event.countDocuments({ 
          userId: alert.userId,
          'notifications.0': { $exists: true }
        }),
        Task.countDocuments({ 
          userId: alert.userId,
          'notifications.0': { $exists: true }
        }),
        Movement.countDocuments({ 
          userId: alert.userId,
          'notifications.0': { $exists: true }
        })
      ]);
      
      console.log(`Usuario ${userName} tiene:`);
      console.log(`  - ${events} eventos con notificaciones`);
      console.log(`  - ${tasks} tareas con notificaciones`);
      console.log(`  - ${movements} movimientos con notificaciones`);
    }
    
    // 4. Recomendaciones
    console.log('\n💡 Recomendaciones para el script de migración:');
    console.log('1. Incluir alertas con read=true aunque delivered=false');
    console.log('2. Usar createdAt como fecha de envío si no hay lastDeliveryAttempt');
    console.log('3. Considerar el estado "read" como indicador de interacción del usuario');
    
    // 5. Propuesta de corrección
    console.log('\n🔧 Propuesta de corrección para el script de migración:');
    console.log('Cambiar el filtro de alertas de:');
    console.log('  delivered: true');
    console.log('A:');
    console.log('  $or: [{ delivered: true }, { read: true }]');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Conexión cerrada');
  }
}

analyzeAlerts().catch(console.error);