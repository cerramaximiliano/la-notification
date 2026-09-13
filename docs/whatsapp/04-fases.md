# 04 — Fases de implementación, riesgos y costos

> **Actualizado 2026-09-13**: provider decidido = Evolution API (Baileys), ver
> `02-provider-adapter.md`. F1 cambia de "alta WABA + aprobación de plantillas HSM" a
> "conseguir la línea + vincular la instancia Evolution API" — sin latencia de aprobación
> externa. **Milestone 1 (F2 adaptado) ya implementado** en `services/channels/whatsapp/`:
> `provider.interface.js`, `providers/evolutionApi.provider.js`, `templates.js` (mensaje breve
> con la lista de carpetas con novedades, sin detalle de movimientos), `outbox.js` +
> `models/WhatsAppOutbox.js`, cron de drenaje en `config/cron.js`. Pendiente: F0 (teléfono/OTP/
> opt-in, bloqueante), F1 (línea + instancia), F4 (webhook inbound) y F3 (enganchar al
> dispatcher real de `services/notifications.js`) — index.js del módulo todavía no está
> llamado desde ahí.

## Fases

### F0 — Prerrequisitos de datos y compliance · **implementado 2026-09-13**
- `phone` / `phoneVerified` / `whatsappOptIn` + `channels.whatsapp` en `User` (hub + espejo). ✔
- Flujo OTP (`/api/phone/verify/start|confirm`) + rate limit (3/h por user + cooldown 60s). ✔
- Validación: no activar `channels.whatsapp` sin verificación + opt-in. ✔
- El envío del código lo hace la-notification (`POST /api/whatsapp/send-otp`, texto libre por
  Evolution API — sin plantilla HSM). Sin línea conectada responde 503 con motivo.
- Detalle: [`01-prerequisitos-otp.md`](./01-prerequisitos-otp.md).

### F1 — Línea(s) propia(s) + instancia(s) Evolution API
- Comprar el chip prepago (persona física con DNI, no número virtual/VoIP) — se puede repetir
  para tener más de una línea (reparte volumen/riesgo, ver `02-provider-adapter.md`).
- Dar de alta WhatsApp normal en ese número, vincularlo por QR a una instancia del deployment
  Evolution API self-hosted (Docker + Postgres + Redis, ver el informe de factibilidad publicado).
- Warm-up de 1–2 semanas por línea antes del primer envío automático.
- Cargar `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`/`EVOLUTION_WEBHOOK_APIKEY` (deployment, una
  sola vez) en el secret compartido `env-8tdon8` de AWS Secrets Manager, y cada línea con
  `node scripts/whatsappInstances.js add <name> <label> [phoneNumber]` → pasar a `connected`
  cuando esté probada.
- Sin latencia de aprobación externa (a diferencia del WABA de Meta) — el camino crítico acá
  es el warm-up de la cuenta, no un proceso de terceros.
- **Ya no bloquea F2**: sin ninguna instancia cargada, el módulo del canal funciona igual — los
  mensajes quedan encolados en `WhatsAppOutbox` esperando la primera línea.

### F2 — Módulo de canal · **implementado 2026-09-13**
- `services/channels/whatsapp/` : `provider.interface.js`, `providers/evolutionApi.provider.js`,
  `index.js`, `templates.js`, `outbox.js`.
- `models/WhatsAppOutbox.js`.
- Cron processor del outbox en `config/cron.js` (`NOTIFICATION_WHATSAPP_OUTBOX_CRON`).
- Endurecido en revisión (mismo día): guard contra solapamiento del cron (evita envíos
  duplicados), expiración de digests pending a 48h (`WHATSAPP_OUTBOX_MAX_AGE_HOURS` — nunca
  soltar el backlog acumulado sobre una línea recién vinculada), `dailyLimit` por instancia
  aplicado, reasignación si la instancia fijada dejó de estar activa, errores 4xx sin
  reintento, `NotificationLog` por movimiento sincronizado por `delivery.outboxId`, webhook
  fail-closed (sin `EVOLUTION_WEBHOOK_APIKEY` rechaza todo), filtro de grupos/broadcast y
  parseo de `connection.update`.
- Kill-switch del canal: `status.whatsappEnabled` en `judicial-notification-configs` (default
  false; `node scripts/whatsappInstances.js channel on|off`). Apagado: no se encola nada y lo
  encolado espera. Falta declararlo en el modelo del hub para exponerlo en la admin UI.
- "Ya notificado" por WhatsApp = existe `NotificationLog` `method:'whatsapp'` para ese
  movimiento (cualquier status). `JudicialMovement.notificationStatus` queda del email. Así el
  dispatcher (F3) puede pasar el mismo `movementsByExpediente` a ambos canales.
- Pendiente: prueba E2E real contra la instancia vinculada (depende de F1).

### F3 — Integración en el dispatcher · **implementado 2026-09-13 (movimientos judiciales)**
- Bloque `whatsapp` en `sendJudicialMovementNotifications` (`services/notifications.js`), justo
  después del envío del email y antes de marcar `notificationStatus`: mismo lote que el email.
  Elegibilidad estricta (`isWhatsappEligible`): `channels.whatsapp` + `phoneVerified` + opt-in
  vigente. **Aditivo al email**: con el email apagado no sale nada por ningún canal.
- Solo encola (`sendJudicialMovementDigest` → `WhatsAppOutbox`); el módulo descarta lo ya
  intentado por WhatsApp y respeta el kill-switch. Independiente del resultado de SES.
- `folderByCausa` ahora trae `folderName` → el WhatsApp lista el nombre de la carpeta del
  usuario (fallback: `expedienteLabel`).
- Rastros: `notifications[]` del `JudicialMovement` (`type:'whatsapp'`) y `NotificationLog`
  por movimiento (`method:'whatsapp'`, `status:'created'` hasta que el outbox lo despacha).
- Pendiente: cédulas (solo email por ahora) y los otros 4 tipos (tareas, calendario,
  vencimientos, inactividad) — mismo patrón cuando se pidan.

### F4 — Webhook inbound · **implementado 2026-09-13**
- `routes/whatsappWebhook.js` + `controllers/whatsappWebhookController.js`, montado en
  `POST /api/whatsapp/webhook` (`app.js`). Auth fail-closed por `apikey` (header o campo del
  body) contra `EVOLUTION_WEBHOOK_APIKEY`. Responde siempre 200 al provider (salvo auth).
- `messages.update`: `sent`→`delivered`→`read` en `WhatsAppOutbox` + `NotificationLog`
  (correlación por `providerMessageId`; la lectura va a `engagement.firstOpenAt/lastOpenAt`).
- `messages.upsert` de un usuario (match por `User.phone`): `BAJA`/`STOP`/`CANCELAR`/... →
  `whatsappOptIn.revokedAt` + `channels.whatsapp=false` **siempre** (aunque el canal esté
  apagado), descarta lo pendiente en el outbox y confirma por la misma línea; cualquier otro
  texto → respuesta automática ("este número no recibe consultas, BAJA para salir") como
  mucho una vez por día. Números desconocidos y grupos: ignorados, sin responder.
- `connection.update`: `close` → `disconnected` (403 → `banned`), `open` → `connected`, en
  `WhatsAppInstance` + invalidación de cache — la línea sale/vuelve a rotación sola.
- La confirmación de opt-in NO va por chat: se hace en la app (F0, `acceptOptIn` al
  confirmar el código). El chat solo maneja la baja.
- **Configuración manual pendiente** (cuando exista la instancia): en Evolution, webhook URL
  `https://notifications.lawanalytics.app/api/whatsapp/webhook`, eventos `MESSAGES_UPSERT`,
  `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, sin base64 de media; `EVOLUTION_WEBHOOK_APIKEY` en el
  secret con el valor que Evolution manda en `apikey`. Verificar que el vhost NGINX de
  worker-003 proxyee ese path.

### F5 — Frontend
- `law-analytics-front` `TabSettings.tsx`: toggle de canal WhatsApp + UI de verificación de
  número + texto de consentimiento (opt-in).
- Interface `NotificationPreferences` del store → `channels.whatsapp`.

### F6 — Rollout gradual
- Feature flag / beta con usuarios internos.
- Monitorear entregas y fallos vía `NotificationLog` (`method:"whatsapp"`) y el outbox.
- Ajustar agrupación/rate-limit según costo real.

## Dependencias entre fases

```
F0 ─┐
    ├─→ F2 ─→ F3 ─→ F4 ─→ F5 ─→ F6
F1 ─┘
(F0 y F1 en paralelo; ambas requeridas antes de F2 real)
```

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Aprobación de plantillas lenta | Bloquea envíos | Arrancar F1 primero; plantillas simples categoría UTILITY |
| Suspensión del número por opt-in flojo | Pierde el canal | Consentimiento explícito + auditado; respetar opt-out |
| Costo por conversación crece | Gasto | Agrupar movimientos del día; rate-limit por usuario; categoría UTILITY |
| Volumen supera outbox-en-Mongo | Latencia/reintentos | Migrar a BullMQ + Redis solo si hace falta |
| Webhook público mal asegurado | Spoofing | Verify token (Meta) / firma (Twilio) obligatorios |
| Número sin WhatsApp activo | Falla de entrega | OTP por WhatsApp valida que el número tiene la app |

## Costos (orden de magnitud)

- **Meta**: cobra por **conversación de 24 h**, no por mensaje. Categoría `utility` en
  Argentina es de bajo costo. Estimar `nº usuarios activos × conversaciones/mes`.
- **Twilio** (si se usa): markup por mensaje encima del costo Meta + posible costo de
  `Verify` por OTP.
- **Infra**: cero box nuevo (vive en worker-003). Sin Redis si se usa outbox-en-Mongo.

## Definición de "listo" (E2E)

- Usuario verifica su teléfono y acepta el opt-in desde settings.
- Un movimiento judicial nuevo dispara un WhatsApp con la plantilla aprobada.
- El estado `delivered` vuelve por el webhook y queda en `NotificationLog`.
- Responder "STOP" deja de enviar y desactiva el canal.
