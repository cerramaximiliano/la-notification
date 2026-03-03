# PJN Sync Progress — Canal WebSocket

Documentación del endpoint `POST /api/sync-progress/update` y su integración
con el canal WebSocket del servicio de notificaciones.

---

## Índice

1. [Descripción](#1-descripción)
2. [Endpoint](#2-endpoint)
3. [Estructura del payload](#3-estructura-del-payload)
4. [Fases del ciclo de vida de una sync](#4-fases-del-ciclo-de-vida-de-una-sync)
5. [Flujo completo](#5-flujo-completo)
6. [Comportamiento ante reconexiones](#6-comportamiento-ante-reconexiones)
7. [Notas de implementación](#7-notas-de-implementación)

---

## 1. Descripción

El sistema de progreso de sincronización PJN permite que los workers del
microservicio `pjn-mis-causas` notifiquen en tiempo real al cliente web del
usuario sobre el avance del proceso de sincronización de sus causas judiciales.

Este servicio actúa como **pass-through**: recibe el evento HTTP del worker y
lo emite por Socket.IO al room del usuario. No persiste ningún dato.

---

## 2. Endpoint

```
POST /api/sync-progress/update
```

**Autenticación:** Bearer token interno (`INTERNAL_SERVICE_TOKEN`).
No usa JWT de usuario — es autenticación servicio a servicio.

**Archivo:** `routes/syncProgress.js`

### Request

```json
{
  "userId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "progress": {
    "phase": "extraction",
    "progress": 23,
    "message": "Extrayendo página 5/65..."
  }
}
```

### Response

```json
{ "success": true, "emitted": true }
```

`emitted: false` si `global.io` no está disponible (situación anormal, se loggea como warn).

### Errores

| Status | Causa |
|--------|-------|
| 400 | `userId` faltante o no es string |
| 400 | `progress` faltante o no es objeto |
| 401 | Token inválido o ausente |
| 500 | Error interno inesperado |

---

## 3. Estructura del payload

El objeto `progress` se emite tal cual al cliente por Socket.IO.
El worker puede incluir los campos que necesite; el cliente los interpreta según `phase`.

### Campos estándar

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `phase` | string | Fase actual del proceso (ver sección 4) |
| `progress` | number | Porcentaje 0–100 |
| `message` | string | Descripción legible del paso actual |

### Campos opcionales por fase

| Fase | Campos adicionales |
|------|--------------------|
| `extraction` | `currentPage`, `totalPages`, `causasProcessed`, `totalExpected` |
| `processing` | `batchNum`, `totalBatches`, `causasProcessed`, `totalExpected` |
| `completed` | `newFolders`, `newCausas` |
| `error` | *(solo `message` con descripción del error)* |

---

## 4. Fases del ciclo de vida de una sync

Las fases siguen el orden de la pipeline de dos workers:

```
credentials-processor          sync-queue-processor
        │                               │
        ▼                               ▼
   "started" (5 %)          "processing" (50 %)
        │                         │
   "extraction" (5–50 %)     "processing" (50–95 %)
        │                         │
       (hand-off)            "completed" (100 %)
```

| Phase | Worker emisor | Rango progress | Significado |
|-------|--------------|----------------|-------------|
| `started` | credentials-processor | 5 % | Login exitoso al portal PJN |
| `extraction` | credentials-processor | 5–50 % | Extracción de causas por páginas |
| `processing` | sync-queue-processor | 50–100 % | Creación de carpetas y causas en DB |
| `completed` | sync-queue-processor | 100 % | Sync finalizada con éxito |
| `error` | cualquier worker | 0 % | Error de credencial o de portal |

---

## 5. Flujo completo

```
Worker (pjn-mis-causas)
  └─ src/utils/notify-ws.js :: notifySyncProgress(userId, progress)
       └─ POST notifications.lawanalytics.app/api/sync-progress/update
            Authorization: Bearer {INTERNAL_SERVICE_TOKEN}
            Body: { userId, progress }
              │
              ▼
         routes/syncProgress.js
              │
              ▼
         io.to(`user-${userId}`).emit('sync_progress', progress)
              │
              ▼ (Socket.IO, room: user-{userId})
         Cliente web (law-analytics-front)
              │
         WebSocketService.ts
         socket.on('sync_progress') → WSMessage<SYNC_PROGRESS>
              │
         WebSocketContext.tsx
         handleMessage → dispatch(pjnSyncStarted | pjnSyncProgress |
                                  pjnSyncCompleted | pjnSyncError)
              │
         Redux store :: pjnSync
              │
         PjnAccountConnect.tsx
         useSelector → render reactivo con barra de progreso y pasos
```

---

## 6. Comportamiento ante reconexiones

El canal WebSocket **no tiene persistencia de estado**. Si el usuario pierde
y recupera la conexión durante una sync activa, no recibirá los eventos
anteriores.

El cliente maneja esto con **rescue polling**: si no llega ningún evento WS
en 20 segundos, comienza a consultar `GET /api/pjn-credentials` cada 10
segundos para detectar el fin de la sync.

Este mecanismo es transparente para la-notification: el servicio WS no
necesita hacer nada especial para soportarlo.

---

## 7. Notas de implementación

### El endpoint es fire-and-forget desde el worker

`notifySyncProgress()` en `pjn-mis-causas/src/utils/notify-ws.js` implementa
reintentos con backoff (hasta 3 intentos) pero si todos fallan, el worker
continúa. La sync **nunca se interrumpe** por un fallo de notificación.

### Rooms de Socket.IO

Cada usuario autenticado se une al room `user-{userId}` al conectarse.
El evento `sync_progress` solo llega al propietario de la credencial.
Si el mismo usuario tiene múltiples pestañas abiertas, todas reciben el evento.

### No hay autenticación de usuario en el endpoint

El endpoint es interno (servicio a servicio). El worker ya sabe el `userId`
del proceso que está ejecutando. No es necesario validar que el `userId`
del body corresponda a ningún usuario autenticado — eso lo garantiza el
contexto del worker.

### global.io

El endpoint accede a la instancia Socket.IO a través de `global.io`, que es
inyectado en `app.js` al inicializarse el servidor. Si `global.io` es `null`
(p. ej., en tests unitarios del router), el endpoint responde `emitted: false`
sin error.

---

*Última actualización: marzo 2026*
