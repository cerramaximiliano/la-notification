#!/usr/bin/env node

/**
 * Test para verificar el manejo de zonas horarias en el webhook
 */

require('dotenv').config();
const axios = require('axios');
const moment = require('moment-timezone');

const BASE_URL = 'http://localhost:3004';
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN || 'test-token-12345';

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testTimezone() {
  log('\n🕐 TEST DE ZONAS HORARIAS EN NOTIFICACIONES\n', 'cyan');
  
  // Hora deseada: 10:30 AM en Argentina
  const horaDeseadaArgentina = '10:30';
  const fecha = moment().add(1, 'day').format('YYYY-MM-DD');
  
  log(`Objetivo: Notificar mañana a las ${horaDeseadaArgentina} hora Argentina`, 'yellow');
  log(`Fecha: ${fecha}\n`, 'yellow');
  
  // Diferentes formas de enviar la misma hora
  const formatos = [
    {
      nombre: 'Con offset -03:00',
      valor: `${fecha}T${horaDeseadaArgentina}:00-03:00`,
      descripcion: 'Hora Argentina con zona horaria explícita'
    },
    {
      nombre: 'UTC calculado',
      valor: moment.tz(`${fecha} ${horaDeseadaArgentina}`, "America/Argentina/Buenos_Aires").utc().format(),
      descripcion: 'Convertido a UTC (13:30Z)'
    },
    {
      nombre: 'Sin zona horaria',
      valor: `${fecha}T${horaDeseadaArgentina}:00`,
      descripcion: 'Asume hora local del servidor'
    }
  ];
  
  for (const formato of formatos) {
    log(`\n📤 Probando: ${formato.nombre}`, 'blue');
    log(`   Valor: ${formato.valor}`, 'blue');
    log(`   ${formato.descripcion}`, 'blue');
    
    const testData = {
      notificationTime: formato.valor,
      movements: [
        {
          userId: "68c1a196f8de85c63ba999f0",
          expediente: {
            id: `TEST-TZ-${Date.now()}`,
            number: 99999,
            year: 2025,
            fuero: "Test Timezone",
            caratula: `PRUEBA TIMEZONE - ${formato.nombre}`,
            objeto: "Verificación de zona horaria"
          },
          movimiento: {
            fecha: new Date().toISOString(),
            tipo: "Test",
            detalle: `Prueba con formato: ${formato.nombre}`,
            url: null
          }
        }
      ]
    };
    
    try {
      const response = await axios.post(
        `${BASE_URL}/api/judicial-movements/webhook/daily-movements`,
        testData,
        {
          headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      
      if (response.data.success) {
        log('   ✅ Creado exitosamente', 'green');
        
        // Calcular cuándo se enviará
        const notifyAt = moment(formato.valor).toDate();
        log(`   ⏰ Se notificará a las: ${notifyAt.getHours()}:${String(notifyAt.getMinutes()).padStart(2, '0')} hora local`, 'green');
        log(`   📅 Que es: ${notifyAt.toISOString()} UTC`, 'green');
      }
    } catch (error) {
      log(`   ❌ Error: ${error.message}`, 'red');
    }
  }
  
  log('\n=== RESUMEN ===', 'cyan');
  log('Todos los formatos anteriores deberían resultar en notificación a las 10:30 AM Argentina', 'yellow');
  log('Recomendación: Usar formato con offset explícito (-03:00) para mayor claridad', 'green');
  
  log('\n💡 EJEMPLO DE USO RECOMENDADO:', 'cyan');
  log('```javascript', 'blue');
  log('// Para notificar a las 10:30 AM en Argentina:', 'blue');
  log('notificationTime: "2025-01-09T10:30:00-03:00"', 'green');
  log('```', 'blue');
}

// Ejecutar test
testTimezone().catch(console.error);