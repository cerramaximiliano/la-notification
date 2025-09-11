# Sistema de Limpieza Automática de Logs

## Descripción General

El sistema de limpieza automática gestiona y mantiene los logs del sistema bajo control, eliminando registros antiguos y previniendo el crecimiento excesivo del almacenamiento.

## Componentes de Limpieza

### 1. Logs del Sistema de Archivos
- Elimina archivos de log antiguos (más de 7 días por defecto)
- Trunca archivos muy grandes (>100MB) manteniendo las últimas 1000 líneas
- Ubicación: `/logs/`

### 2. Logs de MongoDB
- **NotificationLogs**: Historial de notificaciones enviadas (retención: 30 días)
- **Alerts**: Alertas entregadas al navegador (retención: 30 días)
- **JudicialMovements**: Movimientos procesados con estado 'sent' (retención: 60 días)

### 3. Logs de PM2
- Ejecuta `pm2 flush` para limpiar logs del gestor de procesos
- Limpia tanto logs de error como de salida estándar

## Configuración

### Variables de Entorno

```bash
# Cron de limpieza (domingos a las 2 AM por defecto)
CLEANUP_CRON=0 2 * * 0

# Días de retención para cada tipo de log
NOTIFICATION_LOG_RETENTION_DAYS=30
ALERT_LOG_RETENTION_DAYS=30
JUDICIAL_MOVEMENT_RETENTION_DAYS=60
FILE_LOG_RETENTION_DAYS=7
PM2_LOG_RETENTION_DAYS=7

# Habilitar envío de reportes por email
SEND_CLEANUP_REPORTS=true
ADMIN_EMAIL=admin@example.com
```

### Expresiones Cron Comunes

| Expresión | Descripción |
|-----------|-------------|
| `0 2 * * 0` | Domingos a las 2:00 AM |
| `0 3 * * 1` | Lunes a las 3:00 AM |
| `0 0 * * 0` | Domingos a medianoche |
| `0 4 * * 6` | Sábados a las 4:00 AM |
| `0 2 1 * *` | Primer día del mes a las 2:00 AM |

## Ejecución Manual

### Desde la API

```bash
# Ejecutar limpieza completa manualmente
curl -X POST http://localhost:3004/api/cron/execute \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"job": "cleanup"}'
```

### Desde el Servidor

```javascript
// En PM2
pm2 exec notific eval "
  const { comprehensiveCleanupJob } = require('./cron/cleanupJobs');
  comprehensiveCleanupJob().then(console.log).catch(console.error);
"
```

## Proceso de Limpieza

### Flujo de Ejecución

1. **Análisis previo**: Calcula uso de disco actual
2. **Limpieza del filesystem**: 
   - Elimina archivos antiguos
   - Trunca archivos grandes
3. **Limpieza de MongoDB**:
   - Elimina registros según política de retención
4. **Limpieza de PM2**:
   - Ejecuta flush de logs
5. **Análisis posterior**: Calcula espacio liberado
6. **Reporte**: Envía resumen por email (si está configurado)

### Criterios de Limpieza

#### Archivos del Sistema
- **Eliminación**: Archivos más antiguos que `FILE_LOG_RETENTION_DAYS`
- **Truncado**: Archivos actuales que excedan 100MB

#### Base de Datos
- **NotificationLogs**: `sentAt < fecha_actual - NOTIFICATION_LOG_RETENTION_DAYS`
- **Alerts**: `status = 'delivered' AND deliveredAt < fecha_actual - ALERT_LOG_RETENTION_DAYS`
- **JudicialMovements**: `notificationStatus = 'sent' AND updatedAt < fecha_actual - JUDICIAL_MOVEMENT_RETENTION_DAYS`

## Monitoreo

### Logs de Ejecución

El sistema registra:
- Inicio y fin de cada fase de limpieza
- Cantidad de elementos eliminados
- Espacio liberado
- Errores encontrados

### Reporte por Email

Si está habilitado (`SEND_CLEANUP_REPORTS=true`), incluye:
- Resumen de elementos eliminados
- Espacio en disco antes/después
- Detalle por componente
- Lista de errores (si los hay)

## Métricas

### Información Reportada

```json
{
  "timestamp": "2025-01-10T02:00:00Z",
  "duration": 5432,
  "filesystem": {
    "filesProcessed": 10,
    "filesDeleted": 5,
    "filesCleared": 2,
    "totalSizeBefore": 524288000,
    "totalSizeAfter": 10485760
  },
  "mongodb": {
    "notificationLogs": 1500,
    "alerts": 200,
    "judicialMovements": 100
  },
  "pm2": {
    "success": true,
    "sizeBefore": 104857600,
    "sizeAfter": 0
  },
  "diskSpace": {
    "before": { "usedPercentage": "45" },
    "after": { "usedPercentage": "42" }
  },
  "summary": {
    "totalDeleted": 1807,
    "spaceSaved": 618950656,
    "errors": []
  }
}
```

## Mejores Prácticas

### Recomendaciones de Retención

| Tipo de Log | Retención Recomendada | Justificación |
|-------------|----------------------|---------------|
| Notificaciones | 30 días | Auditoría de envíos recientes |
| Alertas | 30 días | Historial de interacciones |
| Movimientos Judiciales | 60 días | Cumplimiento legal |
| Logs de archivo | 7 días | Debugging reciente |
| PM2 | 7 días | Monitoreo de aplicación |

### Consideraciones de Rendimiento

1. **Horario de ejecución**: Programar en horas de baja actividad
2. **Frecuencia**: Semanal es suficiente para la mayoría de casos
3. **Tamaño de lote**: MongoDB elimina en lotes para evitar bloqueos
4. **Índices**: Asegurar índices en campos de fecha para queries eficientes

## Troubleshooting

### Problema: Espacio en disco no se libera

**Solución**:
- Verificar que PM2 no esté reteniendo logs
- Revisar si hay otros procesos escribiendo logs
- Comprobar permisos de escritura/eliminación

### Problema: Limpieza toma mucho tiempo

**Solución**:
- Reducir período de retención
- Aumentar frecuencia de limpieza
- Revisar índices en MongoDB

### Problema: No se envían reportes

**Verificar**:
- `SEND_CLEANUP_REPORTS=true`
- `ADMIN_EMAIL` configurado correctamente
- Servicio de email (AWS SES) funcionando

## Seguridad

### Consideraciones

- Los logs eliminados no son recuperables
- Mantener backups externos si se requiere auditoría a largo plazo
- Logs de seguridad críticos deben archivarse externamente
- Configurar alertas si la limpieza falla repetidamente

## API de Control

### Endpoints Disponibles

```javascript
// Ejecutar limpieza manual
POST /api/cron/execute
{
  "job": "cleanup"
}

// Ver configuración actual
GET /api/admin/cleanup/config

// Ver último resultado de limpieza
GET /api/admin/cleanup/last-run
```

---

*Última actualización: Septiembre 2025*
*Versión: 1.0.0*