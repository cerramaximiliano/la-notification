#!/usr/bin/env node

/**
 * Script para limpiar notificaciones duplicadas en NotificationLog
 * Mantiene solo la primera ocurrencia de cada notificación única
 */

require('dotenv').config();
const mongoose = require('mongoose');
const NotificationLog = require('../models/NotificationLog');

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
    console.log('\n🧹 Limpiando notificaciones duplicadas...\n');
    
    // Encontrar duplicados agrupando por campos únicos
    const duplicates = await NotificationLog.aggregate([
      {
        $group: {
          _id: {
            userId: '$userId',
            entityType: '$entityType',
            entityId: '$entityId',
            sentAt: '$sentAt',
            method: '$notification.method'
          },
          ids: { $push: '$_id' },
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);
    
    console.log(`📊 Encontrados ${duplicates.length} grupos de duplicados`);
    
    let totalDeleted = 0;
    
    for (const group of duplicates) {
      // Mantener el primer ID (más antiguo) y eliminar el resto
      const [keepId, ...deleteIds] = group.ids;
      
      console.log(`  Grupo: ${group._id.entityType} - ${group._id.entityId}`);
      console.log(`    - Manteniendo: ${keepId}`);
      console.log(`    - Eliminando: ${deleteIds.length} duplicados`);
      
      // Eliminar duplicados
      const result = await NotificationLog.deleteMany({
        _id: { $in: deleteIds }
      });
      
      totalDeleted += result.deletedCount;
    }
    
    console.log(`\n✅ Limpieza completada: ${totalDeleted} notificaciones duplicadas eliminadas`);
    
    // Verificar el estado final
    const totalNotifications = await NotificationLog.countDocuments();
    console.log(`📊 Total de notificaciones después de la limpieza: ${totalNotifications}`);
    
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

rl.question('⚠️  Este script eliminará notificaciones duplicadas. ¿Deseas continuar? (s/n): ', (answer) => {
  if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'si') {
    cleanDuplicates().catch(console.error);
  } else {
    console.log('Operación cancelada');
    process.exit(0);
  }
  rl.close();
});