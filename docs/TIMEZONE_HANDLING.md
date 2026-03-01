# Manejo de Zonas Horarias en Notificaciones Judiciales

## Contexto del Problema

El servidor está configurado en **Argentina (UTC-3)**, y MongoDB siempre almacena las fechas en **UTC**. Esto genera una aparente discrepancia cuando se envían y visualizan las horas.

## ¿Qué está pasando?

### Ejemplo Práctico

1. **Envías**: `"2025-01-09T18:30:00.000Z"` (18:30 UTC)
2. **MongoDB guarda**: `2025-01-09T18:30:00.000Z` (siempre en UTC)
3. **En logs/UI aparece**: `21:30` (18:30 UTC + 3 horas = 21:30 Argentina)

### El Flujo Real

```
Cliente envía         MongoDB guarda        Servidor procesa
18:30 UTC      →     18:30 UTC       →     15:30 hora Argentina
                                            (18:30 - 3 horas)
```

## ¿A qué hora se envían las notificaciones?

**Las notificaciones se envían según la hora LOCAL del servidor (Argentina UTC-3)**

### Ejemplo Completo

Si envías `notificationTime: "2025-01-09T18:30:00.000Z"`:

1. **MongoDB guarda**: `18:30 UTC`
2. **El servidor interpreta como**: `15:30 hora Argentina`
3. **El cron job a las 15:30 hora Argentina** encontrará este movimiento
4. **La notificación se enviará a las 15:30 hora local** (18:30 UTC)

## Tabla de Conversión

| Hora enviada (UTC) | Hora en MongoDB | Hora local Argentina | Envío real |
|-------------------|-----------------|---------------------|------------|
| 12:00:00.000Z | 12:00 UTC | 09:00 ART | 09:00 local |
| 15:00:00.000Z | 15:00 UTC | 12:00 ART | 12:00 local |
| 18:30:00.000Z | 18:30 UTC | 15:30 ART | 15:30 local |
| 21:30:00.000Z | 21:30 UTC | 18:30 ART | 18:30 local |

## Recomendaciones

### 1. Para enviar notificaciones a una hora específica de Argentina

**MEJOR OPCIÓN: Enviar con zona horaria explícita**

```javascript
// Formato recomendado con offset -03:00
"notificationTime": "2025-01-09T10:30:00-03:00"
```

**Alternativas válidas:**

```javascript
// Opción 1: Con offset explícito (RECOMENDADO)
"notificationTime": "2025-01-09T10:30:00-03:00"
// → Se notifica a las 10:30 AM Argentina

// Opción 2: Convertido a UTC (requiere cálculo manual)
"notificationTime": "2025-01-09T13:30:00.000Z"  // 10:30 + 3 = 13:30 UTC
// → Se notifica a las 10:30 AM Argentina

// Opción 3: Sin zona horaria (⚠️ CUIDADO: asume hora local del servidor)
"notificationTime": "2025-01-09T10:30:00"
// → Se interpreta como 10:30 AM Argentina (NO suma 3 horas)
// → Se notifica a las 10:30 AM Argentina
```

**⚠️ IMPORTANTE sobre la Opción 3**:
- Sin zona horaria = Se interpreta como hora local del servidor
- **NO se suman 3 horas**
- Si envías `10:30:00`, se notifica a las 10:30 Argentina
- MongoDB lo guardará como `13:30:00Z` (conversión automática a UTC)

### 2. Usar moment-timezone para claridad

```javascript
const moment = require('moment-timezone');

// Hora deseada en Argentina
const horaArgentina = moment.tz("2025-01-09 10:30", "America/Argentina/Buenos_Aires");

// Convertir a UTC para enviar
const horaUTC = horaArgentina.utc().format();
// Resultado: "2025-01-09T13:30:00.000Z"
```

### 3. Función auxiliar para conversión

```javascript
/**
 * Convierte hora local Argentina a UTC para el webhook
 * @param {string} localTime - Hora en formato "HH:mm" (ej: "10:30")
 * @param {string} date - Fecha en formato "YYYY-MM-DD" (ej: "2025-01-09")
 * @returns {string} - ISO string en UTC
 */
function argentinaToUTC(localTime, date) {
  const [hour, minute] = localTime.split(':');
  const moment = require('moment-timezone');
  
  return moment.tz(`${date} ${hour}:${minute}`, 
    "America/Argentina/Buenos_Aires")
    .utc()
    .toISOString();
}

// Ejemplo: Notificar a las 10:30 AM Argentina
const notificationTime = argentinaToUTC("10:30", "2025-01-09");
// Resultado: "2025-01-09T13:30:00.000Z"
```

## Debugging

### Ver la hora actual del servidor

```bash
# Hora local
date

# Zona horaria
timedatectl | grep "Time zone"

# Hora UTC
date -u
```

### Verificar en MongoDB

```javascript
// La fecha se guarda en UTC
db.judicialmovements.findOne()
// notificationSettings.notifyAt: ISODate("2025-01-09T18:30:00.000Z")

// Pero se compara con la hora local del servidor
new Date() // Thu Jan 09 2025 15:30:00 GMT-0300
```

## Resumen

- **MongoDB**: Siempre guarda en UTC
- **Servidor**: Opera en hora local (Argentina UTC-3)
- **Cron jobs**: Ejecutan en hora local del servidor
- **Comparaciones**: Se hacen en hora local

**Regla simple**: 
- Para notificar a las **X horas en Argentina**, envía **X + 3 horas en UTC**
- Ejemplo: Para las 10:30 AM Argentina → envía 13:30 UTC

## Cron Job y Zonas Horarias

El cron job configurado como `*/30 * * * *` ejecuta:
- **Cada 30 minutos en hora local del servidor**
- A las 10:30 Argentina (13:30 UTC)
- A las 16:30 Argentina (19:30 UTC)
- etc.

Las comparaciones con `notifyAt` se hacen en el contexto de hora local, por lo que:
```javascript
// Este código en el cron job
'notificationSettings.notifyAt': { $lte: now }

// Compara:
// notifyAt (convertido a hora local) <= hora actual local
```

---

*Nota: Si el servidor cambia de zona horaria o se migra a otro país, será necesario ajustar las horas de envío acordemente.*