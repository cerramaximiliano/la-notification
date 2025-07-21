#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const Alert = require('../models/Alert');
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

async function checkAlerts() {
  await connectDB();
  
  try {
    console.log('\n🔍 Analizando alertas en la base de datos...\n');
    
    // 1. Total de alertas
    const totalAlerts = await Alert.countDocuments();
    console.log(`📊 Total de alertas: ${totalAlerts}`);
    
    // 2. Alertas por estado de entrega
    const deliveredCount = await Alert.countDocuments({ delivered: true });
    const notDeliveredCount = await Alert.countDocuments({ delivered: false });
    console.log(`✅ Alertas entregadas: ${deliveredCount}`);
    console.log(`⏳ Alertas NO entregadas: ${notDeliveredCount}`);
    
    // 3. Alertas leídas vs no leídas
    const readCount = await Alert.countDocuments({ read: true });
    console.log(`👁️  Alertas leídas: ${readCount}`);
    
    // 4. Mostrar algunas alertas de ejemplo
    console.log('\n📋 Ejemplos de alertas entregadas:');
    const deliveredSamples = await Alert.find({ delivered: true })
      .limit(3)
      .populate('userId', 'name email');
    
    deliveredSamples.forEach((alert, index) => {
      console.log(`\n  ${index + 1}. Alerta ID: ${alert._id}`);
      console.log(`     Usuario: ${alert.userId?.name || 'N/A'} (${alert.userId?.email || 'N/A'})`);
      console.log(`     Texto: ${alert.primaryText}`);
      console.log(`     Descripción: ${alert.secondaryText}`);
      console.log(`     Creada: ${moment(alert.createdAt).format('DD/MM/YYYY HH:mm')}`);
      console.log(`     Último intento: ${alert.lastDeliveryAttempt ? moment(alert.lastDeliveryAttempt).format('DD/MM/YYYY HH:mm') : 'N/A'}`);
      console.log(`     Intentos de entrega: ${alert.deliveryAttempts}`);
    });
    
    // 5. Alertas con lastDeliveryAttempt
    const alertsWithDeliveryAttempt = await Alert.countDocuments({ 
      lastDeliveryAttempt: { $exists: true, $ne: null } 
    });
    console.log(`\n📅 Alertas con fecha de último intento: ${alertsWithDeliveryAttempt}`);
    
    // 6. Distribución por tipo de avatar (tipo de alerta)
    console.log('\n🎨 Distribución por tipo de alerta:');
    const typeDistribution = await Alert.aggregate([
      { $group: { _id: '$avatarType', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    typeDistribution.forEach(type => {
      console.log(`   ${type._id || 'Sin tipo'}: ${type.count}`);
    });
    
    // 7. Alertas por fecha
    console.log('\n📅 Alertas por período:');
    const lastWeek = await Alert.countDocuments({
      createdAt: { $gte: moment().subtract(7, 'days').toDate() }
    });
    const lastMonth = await Alert.countDocuments({
      createdAt: { $gte: moment().subtract(30, 'days').toDate() }
    });
    console.log(`   Última semana: ${lastWeek}`);
    console.log(`   Último mes: ${lastMonth}`);
    
    // 8. Verificar estructura de campos
    console.log('\n🔧 Verificando campos críticos:');
    const sampleAlert = await Alert.findOne().lean();
    if (sampleAlert) {
      console.log('   Campos disponibles en Alert:');
      Object.keys(sampleAlert).forEach(key => {
        console.log(`   - ${key}: ${typeof sampleAlert[key]}`);
      });
    }
    
    // 9. Buscar alertas que podrían tener campos de fecha alternativos
    console.log('\n🔍 Buscando posibles campos de fecha de entrega...');
    
    // Verificar si hay alertas con updatedAt diferente a createdAt (posible indicador de entrega)
    const alertsWithUpdates = await Alert.find({
      $expr: { $ne: ['$createdAt', '$updatedAt'] }
    }).limit(5);
    
    if (alertsWithUpdates.length > 0) {
      console.log(`   Encontradas ${alertsWithUpdates.length} alertas con updatedAt diferente`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Conexión cerrada');
  }
}

checkAlerts().catch(console.error);