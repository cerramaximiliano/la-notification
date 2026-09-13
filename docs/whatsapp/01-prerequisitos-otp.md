# 01 — Prerrequisitos: teléfono, OTP y opt-in (F0, bloqueante)

> **Implementado 2026-09-13** (construido completo, se activa cuando haya línea):
> hub `law-analytics-server` → `models/User.js` (`phone`, `phoneVerified`, `phoneVerifiedAt`,
> `phoneVerification` con hash+TTL+intentos, `whatsappOptIn`, `channels.whatsapp`),
> `controllers/phoneVerificationController.js`, `routes/phoneRoutes.js` (`GET /api/phone/status`,
> `POST /api/phone/verify/start`, `POST /api/phone/verify/confirm`, `DELETE /api/phone`),
> `services/whatsappOtpService.js` (M2M a la-notification con `NOTIFICATION_SERVICE_URL` +
> Bearer `INTERNAL_SERVICE_TOKEN`), validación en `notificationPreferencesController`.
> `la-notification` → `routes/whatsapp.js` (`/api/whatsapp/availability`, `/api/whatsapp/send-otp`)
> + `services/channels/whatsapp/otp.js`. El OTP sale como **texto libre por Evolution API**
> (no hace falta la plantilla HSM de más abajo). Sin línea conectada, `start` responde 503 con
> motivo — el front decide qué mostrar con `availability` de `/status`.

> **Esta fase bloquea todo lo demás.** Sin teléfono verificado y consentimiento explícito
> no se puede enviar ningún WhatsApp (Meta lo exige y puede suspender el número si no se
> respeta).

## Estado actual (verificado en el código)

- `law-analytics-server/models/User.js` **no tiene campo de teléfono del usuario**. Solo
  `email`, `contact` (String genérico) y `country`.
- Hay teléfono en `models/Contact.js` (`phone`, `phoneCodArea`, `phoneCelular`) pero es del
  **dominio SECLO**, no del usuario de la plataforma.
- **No existe** ninguna verificación OTP / SMS en el ecosistema (grep negativo en
  `law-analytics-server` y `la-marketing-service`).
- `preferences.notifications.channels` hoy = `{ email, browser, mobile }`. Falta `whatsapp`.

## Cambios en el modelo `User` (hub)

`law-analytics-server/models/User.js`:

```js
// Datos de contacto verificados
phone: { type: String },              // E.164, ej "+5491155555555"
phoneVerified: { type: Boolean, default: false },
phoneVerifiedAt: { type: Date },

// Consentimiento WhatsApp (compliance Meta — auditado)
whatsappOptIn: {
  accepted:   { type: Boolean, default: false },
  acceptedAt: { type: Date },
  source:     { type: String },       // 'settings_ui' | 'onboarding' | etc
  revokedAt:  { type: Date }          // opt-out vía "STOP"
},

// Canal nuevo
'preferences.notifications.channels.whatsapp': { type: Boolean, default: false }
```

> El **espejo local** `la-notification/models/User.js` debe replicar `phone`,
> `phoneVerified`, `whatsappOptIn` y `channels.whatsapp` (es un schema reducido del mismo
> documento Mongo).

## Flujo de verificación OTP

El número debe verificarse antes de habilitarse. Dos caminos:

### Opción A — OTP propio (recomendado, control total)
1. `POST /api/phone/verify/start` → genera código de 6 dígitos, lo guarda hasheado con TTL
   (5–10 min), y lo envía. Reusar AWS SES no sirve (es teléfono); el envío del código puede
   ir por:
   - WhatsApp mismo (plantilla HSM de OTP aprobada), o
   - SMS (Twilio / SNS) como fallback.
2. `POST /api/phone/verify/confirm` → valida código, setea `phoneVerified = true` +
   `phoneVerifiedAt`.
3. Rate-limit por usuario/IP para evitar abuso.

### Opción B — Twilio Verify (fast-path)
- Twilio maneja el ciclo OTP (envío, reintentos, expiración) con su API `Verify`. Menos
  código propio, pero acopla a Twilio y agrega costo por verificación.

> Recomendación: **Opción A**, enviando el OTP por la **misma plantilla HSM de WhatsApp**
> (así se valida de paso que el número tiene WhatsApp activo). SMS solo como fallback.

## Opt-in / compliance

- El toggle de canal WhatsApp en settings **no alcanza** como consentimiento: debe haber un
  texto explícito ("Acepto recibir notificaciones por WhatsApp de Law Analytics") cuyo
  click setee `whatsappOptIn.accepted = true` + `acceptedAt` + `source`.
- Guardar el consentimiento es **auditoría obligatoria** ante Meta.
- El opt-out (responder "STOP"/"BAJA") setea `whatsappOptIn.revokedAt` y desactiva
  `channels.whatsapp` (lo maneja el webhook inbound — ver [`04-fases.md`](./04-fases.md) F4).

## Endpoints nuevos (hub `law-analytics-server`)

| Método | Ruta | Propósito |
|---|---|---|
| `POST` | `/api/phone/verify/start` | Enviar código OTP al número |
| `POST` | `/api/phone/verify/confirm` | Validar código → `phoneVerified=true` |
| `PUT`  | `/api/notifications/preferences` | (existente) aceptar `channels.whatsapp` + opt-in |

`controllers/notificationPreferencesController.js` debe **rechazar** activar
`channels.whatsapp` si `phoneVerified !== true` o `whatsappOptIn.accepted !== true`.

## Checklist F0

- [ ] Campos `phone`/`phoneVerified`/`whatsappOptIn` + `channels.whatsapp` en User (hub).
- [ ] Replicar campos en el espejo `la-notification/models/User.js`.
- [ ] Endpoints OTP start/confirm + rate limit.
- [ ] Plantilla HSM de OTP (depende de F1, ver [`03-plantillas-hsm.md`](./03-plantillas-hsm.md)).
- [ ] Validación en el controller de preferencias (no activar sin verificar + opt-in).
- [ ] Persistencia auditada del consentimiento.
