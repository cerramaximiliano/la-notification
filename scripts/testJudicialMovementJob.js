/**
 * Script de prueba para el job de notificaciones judiciales con coordinación
 *
 * Ejecutar con: node scripts/testJudicialMovementJob.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function runTest() {
  console.log('='.repeat(60));
  console.log('TEST: judicialMovementNotificationJob con coordinación');
  console.log('='.repeat(60));

  try {
    // Conectar a MongoDB
    console.log('\nConectando a MongoDB...');
    await mongoose.connect(process.env.URLDB);
    console.log('Conectado exitosamente\n');

    // Importar el job después de la conexión
    const { judicialMovementNotificationJob } = require('../cron/notificationJobs');

    console.log('Ejecutando judicialMovementNotificationJob...\n');
    console.log('-'.repeat(60));

    await judicialMovementNotificationJob();

    console.log('-'.repeat(60));
    console.log('\nJob completado exitosamente');

    // Mostrar estadísticas adicionales
    const JudicialMovement = require('../models/JudicialMovement');

    const stats = await JudicialMovement.aggregate([
      {
        $group: {
          _id: '$notificationStatus',
          count: { $sum: 1 }
        }
      }
    ]);

    console.log('\n--- Estado actual de documentos JudicialMovement ---');
    stats.forEach(s => {
      console.log(`  ${s._id}: ${s.count}`);
    });

    // Documentos creados hoy
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await JudicialMovement.countDocuments({
      createdAt: { $gte: today }
    });
    console.log(`\n  Creados hoy: ${todayCount}`);

    await mongoose.disconnect();
    console.log('\nDesconectado de MongoDB');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTest();
