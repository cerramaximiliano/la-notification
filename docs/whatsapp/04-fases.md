# 04 — Fases de implementación, riesgos y costos

> **Actualizado 2026-09-14 — Meta Cloud API es el provider principal** (ver `02-provider-adapter.md`).
> F7 (abajo) implementado: provider Meta, webhook firmado, verificación por mensaje entrante,
> digest en plantilla, mensajes entrantes guardados, registro de números de Meta desde la
> admin. Lo que sigue de este encabezado describe la primera implementación (Baileys), que
> queda como respaldo.
>
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
  sola vez) en el secret compartido `env-8tdon8` de AWS Secrets Manager.
- Alta de cada línea **desde la admin UI**: Notificaciones → Configuración → tarjeta "Líneas
  de WhatsApp" → "Vincular línea nueva" (nombre, etiqueta, número opcional) → muestra el QR
  y el *pairing code* en pantalla, renueva el QR cada 40 s y avisa cuando la conexión queda
  abierta (la línea pasa a `connected` sola). Por detrás: admin-api → la-notification
  (`POST /api/whatsapp/instances`, `GET …/:name/qr`, `GET …/:name/state`, M2M) →
  `services/channels/whatsapp/linking.js` → Evolution (`/instance/create` con webhook y header
  `apikey` = `EVOLUTION_WEBHOOK_APIKEY`, `/instance/connect`, `/instance/connectionState`).
  Las credenciales de Evolution no salen de la-notification.
- Respaldo por consola con la misma lógica: `node scripts/whatsappInstances.js link <name>
  "<label>" +549…` (guarda el QR como PNG e imprime el pairing code) y `qr <name>`. También
  el Manager de Evolution (`/manager`) por Tailscale. **No** hay que leer el QR de los logs.
- Si Evolution devuelve `{count:0}` sin QR o la sesión se cae al vincular (errores 515/408),
  es el meta-issue #2437 del repo: en el `.env` del contenedor `CACHE_REDIS_ENABLED=false`,
  `CACHE_LOCAL_ENABLED=true`, `DATABASE_SAVE_DATA_{CHATS,CONTACTS,HISTORIC,LABELS}=false` y
  reiniciar. Guardar chats/contactos/histórico no aporta nada a este uso.
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
  false). Apagado: no se encola nada y lo encolado espera. Se prende desde la admin UI
  (Notificaciones → Configuración → Estado → "Canal WhatsApp"; declarado en el modelo del
  hub) — `node scripts/whatsappInstances.js channel on|off` queda de respaldo. La misma
  pantalla lista las líneas (`whatsapp-instances`) con status/enabled editables y el outbox
  de hoy (`admin-api /api/judicial-notification-config/whatsapp-instances`).
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

### F5 — Frontend · **implementado 2026-09-13 (sin prueba en navegador todavía)**
- `law-analytics-front`: `WhatsAppChannelPanel.tsx` (número → código por WhatsApp →
  consentimiento obligatorio → verificado; reenvío con cooldown; reactivar tras baja; quitar
  número) dentro del accordion de Canales de `TabSettings.tsx`, con el switch del canal que
  solo se prende con número verificado + opt-in vigente. Sin línea conectada muestra
  "todavía no disponible" (no oculta la opción).
- `ApiService.ts`: `channels.whatsapp` + métodos `/api/phone/*`.
- Hub: `POST /api/phone/opt-in` para volver a aceptar los avisos con un número ya verificado.
- Pendiente: probar en navegador al deployar; toggle `status.whatsappEnabled` en la admin UI.

### F6 — Rollout gradual · **piloto por grants (2026-09-14)**
- `status.whatsappOpenEnrollment` (default false) en `judicial-notification-configs`: mientras
  esté apagado, solo los usuarios con `featureGrants.whatsapp_channel` (admin → Usuarios →
  Feature grants) ven la opción en Configuración y pueden verificar su número
  (`GET /api/phone/status` devuelve `enrollment.allowed` + `availability.reason:'not_enrolled'`;
  `POST /verify/start` responde 403 `WHATSAPP_NOT_ENROLLED`). Los ya verificados siguen
  operando aunque se cierre la inscripción. Switch "Inscripción a WhatsApp abierta a todos" en
  la misma pantalla que el kill-switch. Piloto = grants a los voluntarios + `channel on`.
- Feature flag / beta con usuarios internos.
- Monitorear entregas y fallos vía `NotificationLog` (`method:"whatsapp"`) y el outbox.
- Ajustar agrupación/rate-limit según costo real.

### F7 — Meta Cloud API como provider principal · **implementado 2026-09-14**
- `config/meta.js` + `providers/metaCloud.provider.js`: `sendMessage` texto (ventana de 24 h
  abierta) o plantilla `movimientos_carpetas` (`templateParams` de una línea + botón URL);
  errores 4xx de Graph = permanentes (sin reintento). `providers/index.js` despacha por
  `WhatsAppInstance.provider` ('meta' | 'baileys').
- `models/WhatsAppContact` (ventana de 24 h por teléfono) y `models/WhatsAppMessage` (todo
  mensaje entrante, con `handledAs`; Meta no guarda historial).
- `routes/whatsappMetaWebhook.js` (`/api/whatsapp/meta-webhook`): GET challenge
  (`WHATSAPP_META_WEBHOOK_VERIFY_TOKEN`), POST firmado (`WHATSAPP_META_APP_SECRET` sobre
  `req.rawBody`), responde 200 y procesa después. Mismo controller que Baileys.
- **Verificación por mensaje entrante** (default para todos los providers): el hub
  (`POST /api/phone/verify/start`) devuelve un link `wa.me/<línea>?text=…VERIFICAR-<código>`;
  el usuario lo envía; el webhook llama `POST /api/internal/phone/confirm-inbound` del hub
  (Bearer `INTERNAL_SERVICE_TOKEN`), que verifica + registra opt-in (`source:'whatsapp_inbound'`)
  y prende el canal; se le responde por texto (ventana recién abierta). Front: botón "Abrir
  WhatsApp" + polling del estado. El OTP saliente queda solo con `WHATSAPP_VERIFY_MODE=outbound` (Baileys).
- Registro de un número de Meta: admin → "Vincular línea nueva" → opción Meta (Phone number
  ID) o `scripts/whatsappInstances.js add-meta`; valida contra Graph y queda `connected`.
- Pendiente del usuario: WABA en Meta Business Manager, verificación del negocio, línea (puede
  ser fija), plantilla utility `movimientos_carpetas` aprobada (body "Tenés novedades en {{1}}
  carpeta(s): {{2}}" + botón URL dinámico), webhook suscripto al campo `messages`, tarjeta de
  pago cargada. Límite inicial 250 conversaciones iniciadas/día; sube con la verificación.
- Para desarrollar/probar: número de prueba gratuito de la app de Meta (5 destinatarios).

### F8 — Gating por plan con prueba para el plan gratuito · **implementado 2026-09-14**
Una sola feature de plan pago, `whatsapp_channel`, cubre **avisos proactivos y bot** (el bot
no se regala). Regla, en este orden: `featureGrants.whatsapp_channel` (bypass manual) →
inscripción abierta (`status.whatsappOpenEnrollment`, solo en el hub) → plan pago vigente
(`subscriptions` con `plan` standard/pro/premium, `status` active/trialing/past_due, sin
`testMode` en prod) → prueba del plan gratuito (`User.whatsappTrial {startedAt, endsAt}`).
- **Hub** (`services/whatsappAccessService.js`): `resolveWhatsappAccess(user)` →
  `{allowed, reason: grant|plan|trial|trial_available|trial_expired|plan_required|closed, plan, trial, trialDays}`;
  lo usan `GET /api/phone/status` (campo `enrollment`), `verify/start` y `opt-in` (403
  `WHATSAPP_TRIAL_EXPIRED` / `WHATSAPP_PLAN_REQUIRED` / `WHATSAPP_NOT_ENROLLED`). La prueba
  arranca en la **primera verificación** del número (`startTrialIfNeeded`, también para el
  inbound) y **no se reinicia** al quitar y volver a cargar el número. Duración:
  `status.whatsappTrialDays` del config (admin → Configuración; default 14; 0 = sin prueba,
  solo planes pagos). Tests: `tests/phone/phoneRoutes.test.js` (32).
- **la-notification** (`services/channels/whatsapp/access.js`): `resolveAccess(user)` con la
  misma regla sin el paso de inscripción (quien ya está verificado sigue aunque se cierre el
  piloto). `notifications.js` la consulta antes de `sendJudicialMovementDigest` — sin acceso no
  encola (`skipped`, la preferencia `channels.whatsapp` queda: al pasar a un plan pago vuelve
  solo). El webhook responde a un usuario sin acceso con `buildAccessExpiredText` (texto
  dentro de la ventana de 24 h, gratis) en lugar de la auto-respuesta; el bot (F9) corta ahí.
  `models/User.js` espeja `whatsappTrial` y `featureGrants`.
- **la-subscriptions**: `FEATURE_REQUIREMENTS.whatsapp_channel` (standard/pro/premium, sin
  addon) para `GET /api/internal/plan-allows-feature`; la prueba NO se evalúa ahí.
- **Front**: `enrollment` con `reason/trial/trialDays`; el panel muestra "Incluido en los
  planes… podés probarlo N días", chip "Prueba gratis hasta el …", y con acceso perdido el
  aviso + botón "Ver planes" (`/apps/profiles/account/subscription`); la fila solo se oculta
  en el piloto (`closed`). **Admin**: campo "Prueba de WhatsApp (plan gratuito)" y fila en el
  resumen.
- No se manda ningún mensaje al vencer la prueba (costaría una plantilla); el usuario lo ve en
  Configuración y, si escribe, en la respuesta.
- **Cédulas en el aviso (2026-09-15)**: el digest de WhatsApp incluye las cédulas del mismo
  lote del email, dichas explícitamente ("• Carpeta — 2 novedades y 1 cédula"); ledger propio
  por cédula (`NotificationLog` `entityType:'judicial_cedula'`, `method:'whatsapp'`). El bot
  "novedades" también las muestra. Nombre de carpeta → carátula → número/año como fallback.

### F9 — Bot v1 + observabilidad · **implementado 2026-09-14**
- `services/channels/whatsapp/bot.js` (**v1.5**): para todo texto de un usuario verificado
  que no sea baja ni verificación. Menú de 8 opciones como **lista interactiva** de Meta
  (`interactive.type:'list'`, el usuario toca; en Baileys o si Meta la rechaza, texto
  numerado) y se elige también por número o palabra: 1 Novedades (movimientos de las
  últimas 24 h, mismo `buildMovementDigestText` del aviso), 2 Esta semana (7 días, por
  carpeta con último movimiento), 3 Buscar carpeta (por nombre/número de expediente/carátula;
  pide el texto en un segundo paso — estado en `WhatsAppContact.bot.pendingIntent`, vence a
  los 10 min; también `carpeta <texto>` directo; 1 match → últimos 3 movimientos, varios →
  lista para refinar), 4 Cédulas (7 días), 5 Vencimientos (tareas de los próximos 7 días,
  con carpeta y ‼️ si prioridad alta), 6 Agenda (eventos de los próximos 7 días), 7 Mi cuenta
  (número, avisos, acceso: grant/plan/prueba hasta X), 8 Ayuda. Cualquier otra cosa → menú
  (tope `FALLBACK_MAX_PER_DAY` = 3 por usuario y día; las consultas con contenido no tienen
  tope). Sin acceso (prueba vencida / sin plan) → `buildAccessExpiredText` una vez por día.
  El id de la fila tocada llega como `replyId` en el evento (`interactive.list_reply.id`).
  Todo responde por `reply()` (respeta el kill-switch) como texto dentro de la ventana de 24 h
  que abre el propio mensaje: gratis en Meta. `whatsapp-messages.handledAs` guarda qué hizo
  el bot (`bot_novedades`, `bot_menu`, `bot_fallback`, `bot_fallback_silenced`, `no_access`).
- Dedupe de webhooks repetidos: `storeInbound` devuelve si el `providerMessageId` es nuevo;
  un mensaje ya visto no vuelve a disparar el bot (Meta reintenta si no respondemos rápido).
- Webhook Meta: `message_template_status_update` (aprobación/rechazo de plantillas → log,
  warn si REJECTED/PAUSED) y `phone_number_quality_update` (→ log y
  `WhatsAppInstance.lastConnectionReason = quality:<evento>`; no apaga la línea sola).
- Admin → Notificaciones → Configuración → tarjeta **"Conversaciones de WhatsApp"**:
  línea de tiempo de entrantes (`whatsapp-messages`) y salientes (outbox) con usuario,
  tipo, estado y línea; filtros por teléfono/email (`GET admin-api
  /api/judicial-notification-config/whatsapp-conversations`).
- Plantilla: `novedades_carpetas` salió recategorizada como MARKETING (≈5× el costo) y se
  reemplazó por **`movimientos_carpetas`** (UTILITY, `allow_category_change:false`, cuerpo
  "Hay movimientos nuevos en {{1}} de tus carpetas en Law||Analytics: {{2}}. Podés ver el
  detalle de cada movimiento desde el botón."). El nombre lo fija
  `WHATSAPP_META_TEMPLATE_DIGEST` (default `movimientos_carpetas`). Meta no permite una
  variable al final del cuerpo ni reutilizar un nombre mientras purga la plantilla borrada.
- v2 (pendiente): Claude con tools de la-mcp-server (carpetas, movimientos, jurisprudencia,
  documentos a carpetas por media).

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
