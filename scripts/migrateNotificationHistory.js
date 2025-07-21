#!/usr/bin/env node

/**
 * Script de migración para mover el historial de notificaciones
 * desde los modelos individuales (Event, Task, Movement) y Alert
 * hacia la nueva colección centralizada NotificationLog
 * 
 * Uso: node scripts/migrateNotificationHistory.js [--dry-run] [--batch-size=1000]
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Cargar todos los modelos en el orden correcto para evitar problemas de referencias
const User = require('../models/User');
const Event = require('../models/Event');
const Task = require('../models/Task');
const Movement = require('../models/Movement');
const Alert = require('../models/Alert');
const NotificationLog = require('../models/NotificationLog');

// Parsear argumentos
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 1000;

// Contadores
let stats = {
  events: { total: 0, migrated: 0, errors: 0 },
  tasks: { total: 0, migrated: 0, errors: 0 },
  movements: { total: 0, migrated: 0, errors: 0 },
  alerts: { total: 0, migrated: 0, errors: 0 }
};

// Conectar a la base de datos
async function connectDB() {
  try {
    await mongoose.connect(process.env.URLDB || 'mongodb://localhost:27017/la-notification');
    console.log('✅ Conectado a MongoDB');
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error);
    process.exit(1);
  }
}

// Migrar notificaciones de eventos
async function migrateEvents() {
  console.log('\n📅 Migrando notificaciones de eventos...');
  
  const events = await Event.find({
    'notifications.0': { $exists: true }
  });
  
  stats.events.total = events.length;
  
  for (const event of events) {
    try {
      const logs = [];
      
      // Obtener información del usuario si es necesario
      let userEmail = null;
      if (event.userId) {
        const user = await User.findById(event.userId).select('email');
        userEmail = user?.email;
      }
      
      for (const notification of event.notifications || []) {
        // Verificar si ya existe esta notificación migrada (con ventana de 5 segundos)
        const notificationDate = new Date(notification.date);
        const dateRangeStart = new Date(notificationDate.getTime() - 5000); // 5 segundos antes
        const dateRangeEnd = new Date(notificationDate.getTime() + 5000); // 5 segundos después
        
        const existingLog = await NotificationLog.findOne({
          userId: event.userId,
          entityType: 'event',
          entityId: event._id,
          sentAt: { $gte: dateRangeStart, $lte: dateRangeEnd },
          'notification.method': notification.method || 'email'
        });
        
        if (existingLog) {
          console.log(`    ⏭️  Notificación ya migrada para evento ${event._id}, omitiendo...`);
          continue;
        }
        
        const log = {
          userId: event.userId,
          entityType: 'event',
          entityId: event._id,
          entitySnapshot: {
            title: event.title,
            description: event.description,
            date: event.date,
            type: event.type
          },
          notification: {
            method: notification.method || 'email',
            status: notification.status || (notification.success ? 'sent' : 'failed'),
            content: {
              template: 'calendar_event'
            },
            delivery: {
              recipientEmail: userEmail,
              deliveredAt: notification.date
            }
          },
          config: {
            daysInAdvance: event.notifyConfig?.daysInAdvance,
            notifyOnceOnly: event.notifyConfig?.notifyOnceOnly
          },
          metadata: {
            source: 'migration',
            originalDetails: notification.details
          },
          sentAt: notification.date
        };
        
        logs.push(log);
      }
      
      if (!dryRun && logs.length > 0) {
        await NotificationLog.insertMany(logs);
      }
      
      stats.events.migrated++;
      
      if (stats.events.migrated % 100 === 0) {
        console.log(`  Progreso: ${stats.events.migrated}/${stats.events.total}`);
      }
    } catch (error) {
      console.error(`  Error migrando evento ${event._id}:`, error.message);
      stats.events.errors++;
    }
  }
  
  console.log(`  ✅ Eventos completados: ${stats.events.migrated}/${stats.events.total} (${stats.events.errors} errores)`);
}

// Migrar notificaciones de tareas
async function migrateTasks() {
  console.log('\n📋 Migrando notificaciones de tareas...');
  
  const tasks = await Task.find({
    'notifications.0': { $exists: true }
  });
  
  stats.tasks.total = tasks.length;
  
  for (const task of tasks) {
    try {
      const logs = [];
      
      // Obtener información del usuario si es necesario
      let userEmail = null;
      if (task.userId) {
        const user = await User.findById(task.userId).select('email');
        userEmail = user?.email;
      }
      
      for (const notification of task.notifications || []) {
        // Verificar si ya existe esta notificación migrada
        const existingLog = await NotificationLog.findOne({
          userId: task.userId,
          entityType: 'task',
          entityId: task._id,
          sentAt: notification.date,
          'notification.method': notification.method || 'email'
        });
        
        if (existingLog) {
          console.log(`    ⏭️  Notificación ya migrada para tarea ${task._id}, omitiendo...`);
          continue;
        }
        
        const log = {
          userId: task.userId,
          entityType: 'task',
          entityId: task._id,
          entitySnapshot: {
            title: task.title,
            description: task.description,
            date: task.dueDate,
            priority: task.priority
          },
          notification: {
            method: notification.method || 'email',
            status: notification.status || (notification.success ? 'sent' : 'failed'),
            content: {
              template: 'task_reminder'
            },
            delivery: {
              recipientEmail: userEmail,
              deliveredAt: notification.date
            }
          },
          config: {
            daysInAdvance: task.notifyConfig?.daysInAdvance,
            notifyOnceOnly: task.notifyConfig?.notifyOnceOnly
          },
          metadata: {
            source: 'migration',
            originalDetails: notification.details
          },
          sentAt: notification.date
        };
        
        logs.push(log);
      }
      
      if (!dryRun && logs.length > 0) {
        await NotificationLog.insertMany(logs);
      }
      
      stats.tasks.migrated++;
      
      if (stats.tasks.migrated % 100 === 0) {
        console.log(`  Progreso: ${stats.tasks.migrated}/${stats.tasks.total}`);
      }
    } catch (error) {
      console.error(`  Error migrando tarea ${task._id}:`, error.message);
      stats.tasks.errors++;
    }
  }
  
  console.log(`  ✅ Tareas completadas: ${stats.tasks.migrated}/${stats.tasks.total} (${stats.tasks.errors} errores)`);
}

// Migrar notificaciones de movimientos
async function migrateMovements() {
  console.log('\n💰 Migrando notificaciones de movimientos...');
  
  const movements = await Movement.find({
    'notifications.0': { $exists: true }
  });
  
  stats.movements.total = movements.length;
  
  for (const movement of movements) {
    try {
      const logs = [];
      
      // Obtener información del usuario si es necesario
      let userEmail = null;
      if (movement.userId) {
        const user = await User.findById(movement.userId).select('email');
        userEmail = user?.email;
      }
      
      for (const notification of movement.notifications || []) {
        // Verificar si ya existe esta notificación migrada
        const existingLog = await NotificationLog.findOne({
          userId: movement.userId,
          entityType: 'movement',
          entityId: movement._id,
          sentAt: notification.date,
          'notification.method': notification.type || 'email'
        });
        
        if (existingLog) {
          console.log(`    ⏭️  Notificación ya migrada para movimiento ${movement._id}, omitiendo...`);
          continue;
        }
        
        const log = {
          userId: movement.userId,
          entityType: 'movement',
          entityId: movement._id,
          entitySnapshot: {
            title: movement.title || movement.description,
            description: movement.description,
            date: movement.dateExpiration || movement.expirationDate,
            type: movement.movement || movement.type,
            amount: movement.amount
          },
          notification: {
            method: notification.type || 'email',
            status: notification.success ? 'sent' : 'failed',
            content: {
              template: 'movement_expiration'
            },
            delivery: {
              recipientEmail: userEmail,
              deliveredAt: notification.date
            }
          },
          config: {
            daysInAdvance: movement.notificationSettings?.daysInAdvance,
            notifyOnceOnly: movement.notificationSettings?.notifyOnceOnly
          },
          metadata: {
            source: 'migration',
            originalDetails: notification.details
          },
          sentAt: notification.date
        };
        
        logs.push(log);
      }
      
      if (!dryRun && logs.length > 0) {
        await NotificationLog.insertMany(logs);
      }
      
      stats.movements.migrated++;
      
      if (stats.movements.migrated % 100 === 0) {
        console.log(`  Progreso: ${stats.movements.migrated}/${stats.movements.total}`);
      }
    } catch (error) {
      console.error(`  Error migrando movimiento ${movement._id}:`, error.message);
      stats.movements.errors++;
    }
  }
  
  console.log(`  ✅ Movimientos completados: ${stats.movements.migrated}/${stats.movements.total} (${stats.movements.errors} errores)`);
}

// Migrar alertas entregadas
async function migrateAlerts() {
  console.log('\n🔔 Migrando alertas entregadas...');
  
  // Incluir alertas entregadas O leídas (para capturar casos donde se leyó sin marcar como entregada)
  const alerts = await Alert.find({
    $or: [
      { delivered: true },
      { read: true }
    ]
  });
  
  stats.alerts.total = alerts.length;
  
  for (const alert of alerts) {
    try {
      // Verificar si ya existe esta alerta migrada
      const existingLog = await NotificationLog.findOne({
        userId: alert.userId,
        entityType: 'alert',
        entityId: alert._id
      });
      
      if (existingLog) {
        console.log(`    ⏭️  Alerta ${alert._id} ya migrada, omitiendo...`);
        stats.alerts.migrated++;
        continue;
      }
      
      const log = {
        userId: alert.userId,
        entityType: 'alert',
        entityId: alert._id,
        entitySnapshot: {
          title: alert.primaryText || 'Alerta',
          description: alert.secondaryText,
          date: alert.lastDeliveryAttempt || alert.createdAt,
          type: alert.avatarType || 'notification'
        },
        notification: {
          method: 'browser',
          status: alert.delivered ? 'delivered' : (alert.read ? 'sent' : 'pending'),
          content: {
            subject: alert.primaryText || 'Alerta',
            message: alert.secondaryText,
            data: {
              actionText: alert.actionText,
              avatarIcon: alert.avatarIcon
            }
          },
          delivery: {
            deliveredAt: alert.lastDeliveryAttempt || alert.createdAt,
            attempts: alert.deliveryAttempts
          }
        },
        metadata: {
          source: 'migration',
          folderId: alert.folderId,
          groupId: alert.groupId
        },
        sentAt: alert.lastDeliveryAttempt || alert.createdAt
      };
      
      if (!dryRun) {
        await NotificationLog.create(log);
      }
      
      stats.alerts.migrated++;
      
      if (stats.alerts.migrated % 100 === 0) {
        console.log(`  Progreso: ${stats.alerts.migrated}/${stats.alerts.total}`);
      }
    } catch (error) {
      console.error(`  Error migrando alerta ${alert._id}:`, error.message);
      stats.alerts.errors++;
    }
  }
  
  console.log(`  ✅ Alertas completadas: ${stats.alerts.migrated}/${stats.alerts.total} (${stats.alerts.errors} errores)`);
}

// Función principal
async function main() {
  console.log('🚀 Script de migración de historial de notificaciones');
  console.log(`📊 Tamaño de lote: ${batchSize}`);
  console.log(`🔍 Modo: ${dryRun ? 'DRY RUN (sin cambios)' : 'MIGRACIÓN REAL'}`);
  
  await connectDB();
  
  try {
    await migrateEvents();
    await migrateTasks();
    await migrateMovements();
    await migrateAlerts();
    
    console.log('\n📊 Resumen de la migración:');
    console.log('================================');
    console.log(`Eventos:     ${stats.events.migrated}/${stats.events.total} migrados (${stats.events.errors} errores)`);
    console.log(`Tareas:      ${stats.tasks.migrated}/${stats.tasks.total} migradas (${stats.tasks.errors} errores)`);
    console.log(`Movimientos: ${stats.movements.migrated}/${stats.movements.total} migrados (${stats.movements.errors} errores)`);
    console.log(`Alertas:     ${stats.alerts.migrated}/${stats.alerts.total} migradas (${stats.alerts.errors} errores)`);
    console.log('================================');
    
    const totalMigrated = stats.events.migrated + stats.tasks.migrated + stats.movements.migrated + stats.alerts.migrated;
    const totalErrors = stats.events.errors + stats.tasks.errors + stats.movements.errors + stats.alerts.errors;
    
    console.log(`TOTAL: ${totalMigrated} notificaciones migradas, ${totalErrors} errores`);
    
    if (dryRun) {
      console.log('\n⚠️  Este fue un DRY RUN. Ningún dato fue modificado.');
      console.log('Para ejecutar la migración real, ejecuta el script sin --dry-run');
    }
    
  } catch (error) {
    console.error('\n❌ Error durante la migración:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Conexión a la base de datos cerrada');
  }
}

// Ejecutar
main().catch(console.error);