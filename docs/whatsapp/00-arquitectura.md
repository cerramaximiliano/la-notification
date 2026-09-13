# 00 — Arquitectura: módulo dentro de `la-notification`

## Decisión

WhatsApp se implementa como un **módulo aislado dentro de `la-notification`**, no como
microservicio independiente.

## Razonamiento

`la-notification` **ya es el dispatcher de notificaciones** y posee todo lo que un canal
de WhatsApp necesita reutilizar:

- Las 5 funciones de envío (`services/notifications.js`, ~1667 líneas) que ya hacen
  *channel-matching* entre `email` y `browser`.
- Lectura de preferencias por usuario y por tipo de evento (`models/User.js` →
  `preferences.notifications`).
- Persistencia con `NotificationLog` — su enum `notification.method` ya contempla `sms` y
  el campo `notification.delivery.recipientPhone` **ya existe**.
- Los `templateProcessor`s por tipo (movement, task, calendar, folder, event).
- Cron jobs diarios que ya seleccionan qué notificar (`config/cron.js`, `cron/notificationJobs.js`).

Un microservicio separado obligaría a **duplicar** la lectura de preferencias y el
templating, o a un *hop* de red por cada notificación. WhatsApp acá es conceptualmente
**un tercer canal junto a email y browser**, no un dominio nuevo.

| Criterio | Módulo en `la-notification` ✅ | Microservicio nuevo ❌ |
|---|---|---|
| Reutiliza preferencias/templates/NotificationLog | Directo | Duplicar o cross-call |
| Channel-matching junto a email/browser | Natural (mismo lugar) | Coordinación extra |
| Inbound webhook de Meta (estados + opt-out) | 1 router más | Lo justifica, pero no alcanza solo |
| Esfuerzo operativo (PM2/secrets/deploy) | Cero box nuevo | Box + secret + deploy + monitor skill |

## Aislamiento (para poder extraerlo después)

Aunque vive dentro de `la-notification`, se construye **autocontenido** para que un futuro
split a microservicio no implique reescritura:

- Toda la lógica WhatsApp bajo `services/channels/whatsapp/`.
- Provider detrás de un adapter intercambiable (ver [`02-provider-adapter.md`](./02-provider-adapter.md)).
- Outbox propio + router de webhook propio.

### Criterios para re-evaluar el split a microservicio

- Chat conversacional bidireccional (más allá de notificar + opt-out).
- Alto volumen que justifique escalado/colas independientes.
- Necesidad de aislar credenciales/compliance de WhatsApp del resto.

## Estructura de carpetas (implementación futura)

```
la-notification/
├── services/channels/whatsapp/
│   ├── index.js                  # sendWhatsAppNotification(userId, user, payload, entityType, entityId)
│   ├── provider.interface.js     # contrato del provider
│   ├── providers/
│   │   ├── metaCloud.provider.js # Meta Cloud API (recomendado)
│   │   └── twilio.provider.js    # alternativa fast-path
│   ├── templates.js              # mapa evento→plantilla HSM + armado de variables
│   └── outbox.js                 # encolar/procesar/retry sobre WhatsAppOutbox
├── routes/whatsappWebhook.js     # inbound: delivery receipts + opt-out "STOP"
├── models/
│   ├── WhatsAppOutbox.js         # mensajes encolados/enviados/fallidos (idempotencia + retry)
│   └── NotificationLog.js        # enum method += "whatsapp"
└── config/cron.js                # + cron processor del outbox
```

## Integración con el dispatcher existente

En cada una de las 5 funciones de `services/notifications.js` se agrega un bloque que
replica el patrón de email/browser:

```js
// Patrón existente (email/browser) → se añade whatsapp
const channels = user?.preferences?.notifications?.channels || {};
const whatsappEnabled = channels.whatsapp === true && user.phoneVerified === true;

if (whatsappEnabled) {
  const { sendWhatsAppNotification } = require('./channels/whatsapp');
  await sendWhatsAppNotification(userId, user, payload, 'judicial_movement', movementId);
  // internamente: encola en WhatsAppOutbox + registra NotificationLog method:"whatsapp"
}
```

Las preferencias por tipo de evento (`user.calendar`, `user.expiration`,
`user.taskExpiration`, `user.inactivity`) se respetan igual que hoy; WhatsApp solo agrega
una dimensión de **canal**, no de **tipo**.

## Cola / reintentos: outbox en Mongo (no Redis)

`la-notification` hoy **no tiene Redis ni BullMQ** — solo `node-cron` síncrono. En vez de
introducir infra nueva, se usa un **outbox persistente en Mongo**:

- `sendWhatsAppNotification()` **no llama al provider directamente**: inserta un documento
  en `WhatsAppOutbox` con `status: "pending"` y una `idempotencyKey`.
- Un cron cada 1–2 min toma los `pending`, llama al provider, y marca `sent`/`failed` con
  `attempts` + backoff. El webhook de delivery luego promueve `sent` → `delivered`.
- Idempotencia: `idempotencyKey = hash(userId + entityType + entityId + templateName)`
  evita duplicados si un cron se solapa o reintenta.

### Modelo `WhatsAppOutbox` (borrador)

```js
{
  userId: ObjectId,
  idempotencyKey: { type: String, unique: true },
  to: String,                      // teléfono E.164
  templateName: String,            // plantilla HSM aprobada
  variables: Object,               // valores para la plantilla
  entityType: String,              // 'judicial_movement' | 'task' | 'event' | 'inactivity' | 'seclo'
  entityId: ObjectId,
  status: { type: String, enum: ['pending','sent','delivered','read','failed'], default: 'pending' },
  providerMessageId: String,       // id devuelto por Meta/Twilio
  attempts: { type: Number, default: 0 },
  nextAttemptAt: Date,             // backoff
  failureReason: String,
  createdAt: Date,
  sentAt: Date,
  deliveredAt: Date
}
```

> Migrar a **BullMQ + Redis** solo si el volumen lo exige. Para el volumen estimado
> (5–50 msgs/mes por usuario) el outbox en Mongo alcanza de sobra.

## Notas operativas

- `la-notification` corre en **worker-003 (98.85.31.199)**, PM2 `notification-service`
  (fork, max-mem 800M, `cron_restart` diario 3 AM), mismo box que mev-api + la-subscriptions.
- El **webhook inbound de Meta** necesita exposición pública vía NGINX → coordinar vhost
  (ej. `notifications.lawanalytics.app/api/whatsapp/webhook`).
- Routers actualmente montados en `app.js`: `/api/monitoring`, `/api/alerts`,
  `/api/judicial-movements`, `/api/folder-events`, `/api/sync-progress`,
  `/api/seclo-events`, `/api/system-status`. Se agrega `/api/whatsapp`.
- Secrets vía AWS Secrets Manager (región `sa-east-1`, ARN en `config/env.js`).
