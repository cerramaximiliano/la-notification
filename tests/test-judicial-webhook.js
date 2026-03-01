#!/usr/bin/env node

/**
 * Script de prueba para el webhook de movimientos judiciales
 * Simula una request real con datos de prueba
 */

require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../config/logger');

// Configuración
const BASE_URL = 'http://localhost:3004';  // Forzar URL local
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/law-notifications';

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Datos de prueba simulando una request real
const testData = {
  notificationTime: new Date(Date.now() + 60000).toISOString(), // En 1 minuto
  movements: [
    {
      userId: "68c1a196f8de85c63ba999f0", // ID del usuario cerramaximiliano@gmail.com
      expediente: {
        id: "EXP2025-001",
        number: 45678,
        year: 2025,
        fuero: "Civil y Comercial",
        caratula: "PEREZ JUAN C/ EMPRESA SA S/ DAÑOS Y PERJUICIOS",
        objeto: "Indemnización por daños y perjuicios"
      },
      movimiento: {
        fecha: new Date().toISOString(),
        tipo: "Sentencia Definitiva",
        detalle: "Se dicta sentencia definitiva haciendo lugar parcialmente a la demanda. Se condena a la demandada a abonar la suma de $500.000 con más intereses.",
        url: "https://scw.pjn.gov.ar/documento/45678"
      }
    },
    {
      userId: "68c1a196f8de85c63ba999f0", // Mismo usuario, otro movimiento
      expediente: {
        id: "EXP2025-002",
        number: 45679,
        year: 2025,
        fuero: "Laboral",
        caratula: "GONZALEZ MARIA C/ COMERCIO SRL S/ DESPIDO",
        objeto: "Despido injustificado"
      },
      movimiento: {
        fecha: new Date().toISOString(),
        tipo: "Audiencia",
        detalle: "Se fija audiencia de conciliación para el día 15/02/2025 a las 10:00 hs.",
        url: null
      }
    },
    {
      userId: "68c1a196f8de85c63ba999f0", // Tercer movimiento
      expediente: {
        id: "EXP2025-003",
        number: 45680,
        year: 2025,
        fuero: "Comercial",
        caratula: "BANCO X C/ DEUDOR Y S/ EJECUTIVO",
        objeto: "Cobro ejecutivo"
      },
      movimiento: {
        fecha: new Date(Date.now() - 86400000).toISOString(), // Ayer
        tipo: "Embargo",
        detalle: "Se ordena trabar embargo sobre las cuentas bancarias del demandado hasta cubrir la suma de $1.000.000.",
        url: "https://scw.pjn.gov.ar/documento/45680"
      }
    }
  ]
};

// Función para verificar el estado en la base de datos
async function verifyInDatabase() {
  try {
    await mongoose.connect(MONGODB_URI);
    log('\n📊 Verificando en la base de datos...', 'cyan');
    
    const JudicialMovement = require('../models/JudicialMovement');
    const movements = await JudicialMovement.find({
      userId: "68c1a196f8de85c63ba999f0"
    }).sort({ createdAt: -1 }).limit(5);
    
    log(`Encontrados ${movements.length} movimientos judiciales en la BD`, 'blue');
    
    movements.forEach((movement, index) => {
      log(`\nMovimiento ${index + 1}:`, 'yellow');
      log(`  - Expediente: ${movement.expediente.number}/${movement.expediente.year}`);
      log(`  - Carátula: ${movement.expediente.caratula}`);
      log(`  - Tipo: ${movement.movimiento.tipo}`);
      log(`  - Fecha: ${new Date(movement.movimiento.fecha).toLocaleDateString()}`);
      log(`  - Estado: ${movement.notificationStatus}`);
      log(`  - Notificar a las: ${new Date(movement.notificationSettings.notifyAt).toLocaleString()}`);
      log(`  - Notificaciones enviadas: ${movement.notifications.length}`);
      
      if (movement.notifications.length > 0) {
        movement.notifications.forEach(notif => {
          log(`    * ${notif.type} - ${notif.success ? '✓' : '✗'} - ${notif.details}`);
        });
      }
    });
    
    await mongoose.disconnect();
  } catch (error) {
    log(`Error verificando en BD: ${error.message}`, 'red');
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  }
}

// Función principal de prueba
async function runTest() {
  log('🧪 Iniciando prueba del webhook de movimientos judiciales\n', 'cyan');
  
  // Verificar configuración
  if (!INTERNAL_SERVICE_TOKEN) {
    log('⚠️  INTERNAL_SERVICE_TOKEN no está configurado en .env', 'yellow');
    log('Usando token de prueba: test-token-12345', 'yellow');
  }
  
  const token = INTERNAL_SERVICE_TOKEN || 'test-token-12345';
  
  log(`📍 URL: ${BASE_URL}/api/judicial-movements/webhook/daily-movements`, 'blue');
  log(`🔑 Token: ${token.substring(0, 10)}...`, 'blue');
  log(`📦 Enviando ${testData.movements.length} movimientos judiciales\n`, 'blue');
  
  // Mostrar datos a enviar
  testData.movements.forEach((mov, index) => {
    log(`Movimiento ${index + 1}:`, 'yellow');
    log(`  - Expediente: ${mov.expediente.number}/${mov.expediente.year} - ${mov.expediente.caratula}`);
    log(`  - Tipo: ${mov.movimiento.tipo}`);
    log(`  - Detalle: ${mov.movimiento.detalle.substring(0, 50)}...`);
  });
  
  try {
    log('\n📤 Enviando request...', 'cyan');
    
    const response = await axios.post(
      `${BASE_URL}/api/judicial-movements/webhook/daily-movements`,
      testData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    log('\n✅ Request exitosa!', 'green');
    log('\n📥 Respuesta:', 'cyan');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Verificar resultados
    const { results } = response.data;
    if (results) {
      log('\n📊 Resumen:', 'blue');
      log(`  - Recibidos: ${results.received}`);
      log(`  - Creados: ${results.created}`, results.created > 0 ? 'green' : 'yellow');
      log(`  - Duplicados: ${results.duplicates}`, results.duplicates > 0 ? 'yellow' : 'green');
      log(`  - Errores: ${results.errors.length}`, results.errors.length > 0 ? 'red' : 'green');
      
      if (results.errors.length > 0) {
        log('\n⚠️  Errores encontrados:', 'red');
        results.errors.forEach(err => {
          log(`  - ${err}`, 'red');
        });
      }
    }
    
    // Verificar en base de datos
    await verifyInDatabase();
    
    log('\n✅ Prueba completada exitosamente!', 'green');
    
  } catch (error) {
    log('\n❌ Error en la request:', 'red');
    
    if (error.response) {
      // El servidor respondió con un error
      log(`Status: ${error.response.status}`, 'red');
      log(`Mensaje: ${error.response.data.message || 'Sin mensaje'}`, 'red');
      console.log('\nDetalles del error:', error.response.data);
    } else if (error.request) {
      // La request se hizo pero no hubo respuesta
      log('No se recibió respuesta del servidor', 'red');
      log('¿Está el servidor ejecutándose?', 'yellow');
      log(`Verifica que el servidor esté corriendo en ${BASE_URL}`, 'yellow');
    } else {
      // Error configurando la request
      log(`Error: ${error.message}`, 'red');
    }
    
    process.exit(1);
  }
}

// Función para limpiar datos de prueba (opcional)
async function cleanupTestData() {
  try {
    await mongoose.connect(MONGODB_URI);
    const JudicialMovement = require('../models/JudicialMovement');
    
    log('\n🧹 ¿Deseas limpiar los datos de prueba? (s/n)', 'yellow');
    
    process.stdin.once('data', async (data) => {
      const answer = data.toString().trim().toLowerCase();
      
      if (answer === 's' || answer === 'y') {
        const result = await JudicialMovement.deleteMany({
          'expediente.id': { $in: ['EXP2025-001', 'EXP2025-002', 'EXP2025-003'] }
        });
        
        log(`✅ Eliminados ${result.deletedCount} movimientos de prueba`, 'green');
      } else {
        log('Datos de prueba conservados', 'blue');
      }
      
      await mongoose.disconnect();
      process.exit(0);
    });
    
  } catch (error) {
    log(`Error en limpieza: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Ejecutar prueba
runTest().then(() => {
  log('\n¿Deseas limpiar los datos de prueba? (s/n)', 'yellow');
  cleanupTestData();
}).catch(error => {
  log(`Error inesperado: ${error.message}`, 'red');
  process.exit(1);
});