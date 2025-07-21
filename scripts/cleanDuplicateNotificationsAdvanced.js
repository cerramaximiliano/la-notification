#!/usr/bin/env node

/**
 * Script avanzado para limpiar notificaciones duplicadas en NotificationLog
 * Considera duplicadas las notificaciones con fechas muy cercanas (dentro de 5 segundos)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const NotificationLog = require('../models/NotificationLog');
const moment = require('moment');

async function connectDB() {
  try {
    await mongoose.connect(process.env.URLDB || 'mongodb://localhost:27017/la-notification');
    console.log('✅ Conectado a MongoDB');
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error);
    process.exit(1);
  }
}

async function cleanDuplicates() {
  await connectDB();
  
  try {
    console.log('\n🧹 Limpiando notificaciones duplicadas (avanzado)...\n');
    
    // Obtener todas las notificaciones ordenadas
    const allNotifications = await NotificationLog.find({})
      .sort({ userId: 1, entityType: 1, entityId: 1, sentAt: 1 })
      .lean();
    
    console.log(`📊 Total de notificaciones: ${allNotifications.length}`);
    
    const toDelete = [];
    const processed = new Set();
    
    // Agrupar notificaciones similares
    for (let i = 0; i < allNotifications.length; i++) {
      const current = allNotifications[i];
      
      // Skip si ya fue procesada
      if (processed.has(current._id.toString())) continue;
      
      processed.add(current._id.toString());
      const group = [current];
      
      // Buscar notificaciones similares
      for (let j = i + 1; j < allNotifications.length; j++) {
        const next = allNotifications[j];
        
        // Verificar si es del mismo usuario, tipo y entidad
        if (current.userId.toString() === next.userId.toString() &&
            current.entityType === next.entityType &&
            current.entityId.toString() === next.entityId.toString() &&
            current.notification.method === next.notification.method) {
          
          // Verificar si las fechas están dentro de 5 segundos
          const currentDate = moment(current.sentAt);
          const nextDate = moment(next.sentAt);
          const diffSeconds = Math.abs(currentDate.diff(nextDate, 'seconds'));
          
          if (diffSeconds <= 5) {
            group.push(next);
            processed.add(next._id.toString());
          }
        }
      }
      
      // Si hay duplicados en el grupo
      if (group.length > 1) {
        console.log(`\n📋 Grupo de duplicados encontrado:`);
        console.log(`   Tipo: ${current.entityType}`);
        console.log(`   Entidad: ${current.entityId}`);
        console.log(`   Usuario: ${current.userId}`);
        console.log(`   Método: ${current.notification.method}`);
        console.log(`   Notificaciones en el grupo: ${group.length}`);
        
        // Mostrar las fechas
        group.forEach((notif, idx) => {
          console.log(`     ${idx + 1}. ${moment(notif.sentAt).format('DD/MM/YYYY HH:mm:ss.SSS')} - ID: ${notif._id}`);
        });
        
        // Mantener la primera, eliminar el resto
        const [keep, ...remove] = group;
        console.log(`   ✅ Manteniendo: ${keep._id} (${moment(keep.sentAt).format('HH:mm:ss.SSS')})`);
        console.log(`   ❌ Eliminando: ${remove.length} duplicados`);
        
        toDelete.push(...remove.map(r => r._id));
      }
    }
    
    console.log(`\n📊 Resumen:`);
    console.log(`   - Total de notificaciones: ${allNotifications.length}`);
    console.log(`   - Duplicados a eliminar: ${toDelete.length}`);
    console.log(`   - Notificaciones que quedarán: ${allNotifications.length - toDelete.length}`);
    
    if (toDelete.length > 0) {
      // Eliminar duplicados
      const result = await NotificationLog.deleteMany({
        _id: { $in: toDelete }
      });
      
      console.log(`\n✅ Eliminados ${result.deletedCount} duplicados`);
    } else {
      console.log(`\n✅ No se encontraron duplicados para eliminar`);
    }
    
  } catch (error) {
    console.error('❌ Error durante la limpieza:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Conexión cerrada');
  }
}

// Ejecutar con confirmación
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🔍 Este script considera duplicadas las notificaciones que:');
console.log('   - Son del mismo usuario, tipo, entidad y método');
console.log('   - Tienen fechas de envío dentro de 5 segundos de diferencia');
console.log('   - Mantiene la más antigua y elimina las demás\n');

rl.question('⚠️  ¿Deseas continuar? (s/n): ', (answer) => {
  if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'si') {
    cleanDuplicates().catch(console.error);
  } else {
    console.log('Operación cancelada');
    process.exit(0);
  }
  rl.close();
});