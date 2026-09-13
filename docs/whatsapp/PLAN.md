# Canal de WhatsApp para notificaciones — Plan maestro

> Estado: **propuesta / diseño** — sin implementación todavía.
> Ubicación de la implementación futura: `la-notification/services/channels/whatsapp/`.
> Última actualización: 2026-06-22.

## Resumen ejecutivo

Agregar **WhatsApp como tercer canal de notificación** del ecosistema Law Analytics,
junto a `email` (AWS SES) y `browser` (Socket.io), reutilizando el dispatcher que ya
vive en `la-notification`.

**Decisión arquitectónica tomada:** se implementa como un **módulo aislado dentro de
`la-notification`**, NO como microservicio separado. Ver [`00-arquitectura.md`](./00-arquitectura.md)
para el razonamiento completo y los criterios de re-evaluación.

## Por qué WhatsApp no es "otro email"

Tres restricciones de la plataforma de WhatsApp condicionan todo el diseño:

1. **Plantillas HSM pre-aprobadas obligatorias.** Todas nuestras notificaciones son
   *business-initiated* (las dispara un cron/worker). Fuera de la ventana de 24 h, Meta
   solo permite enviar plantillas aprobadas — no texto libre. Ver [`03-plantillas-hsm.md`](./03-plantillas-hsm.md).
2. **Opt-in explícito + teléfono verificado.** Hoy el `User` no tiene `phone`. Hay que
   agregar teléfono verificado (OTP) y consentimiento auditado. Ver [`01-prerequisitos-otp.md`](./01-prerequisitos-otp.md).
3. **Opt-out / "STOP".** Inbound webhook para dejar de enviar si el usuario se da de baja.

## Índice de documentos

| Doc | Contenido |
|---|---|
| [`00-arquitectura.md`](./00-arquitectura.md) | Decisión módulo-vs-microservicio, estructura de carpetas, integración con el dispatcher, cola/outbox |
| [`01-prerequisitos-otp.md`](./01-prerequisitos-otp.md) | Campo `phone` en User, flujo de verificación OTP, opt-in/compliance (F0, **bloqueante**) |
| [`02-provider-adapter.md`](./02-provider-adapter.md) | Contrato del provider, Meta Cloud API vs Twilio, env/secrets |
| [`03-plantillas-hsm.md`](./03-plantillas-hsm.md) | Catálogo de plantillas por tipo de notificación, variables, proceso de aprobación |
| [`04-fases.md`](./04-fases.md) | Plan de implementación por fases (F0–F6), riesgos, costos |

## Notificaciones objetivo (priorizadas)

| Prioridad | Notificación | Origen | Apto WhatsApp |
|---|---|---|---|
| ⭐⭐⭐⭐⭐ | Movimientos judiciales nuevos | webhook PJN/SCBA | ✅ caso estrella |
| ⭐⭐⭐⭐⭐ | Caducidad / prescripción de expedientes | cron inactividad | ✅ |
| ⭐⭐⭐⭐ | Vencimiento de tareas | cron tasks | ✅ |
| ⭐⭐⭐⭐ | Eventos de calendario / audiencias | cron calendar | ✅ |
| ⭐⭐⭐⭐ | SECLO (solo completado/error) | trabajo-worker | ✅ selectivo |
| ❌ | sync-progress, folder-events, system-status | WebSocket | NO (técnico/real-time) |

## Repos impactados

- **`la-notification`** — núcleo del trabajo (módulo, outbox, webhook, integración en dispatcher).
- **`law-analytics-server`** — `phone`/`phoneVerified` en `User`, endpoints OTP, validación del toggle.
- **`law-analytics-front`** — toggle de canal WhatsApp + UI de verificación + texto de consentimiento.
