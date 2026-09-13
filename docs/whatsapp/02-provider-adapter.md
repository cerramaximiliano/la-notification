# 02 — Provider adapter: Evolution API (decidido) vs Meta Cloud API vs Twilio

> **Actualizado 2026-09-13**: se decidió arrancar con **Evolution API en modo
> Baileys**, con una línea propia (chip prepago) — no Meta Cloud API ni
> Twilio. Ver el informe de factibilidad publicado (Camino A vs Camino B) y
> `docs/whatsapp/04-fases.md` para el detalle. Esta página se mantiene
> vigente para el día que el volumen justifique migrar a Meta Cloud API
> (Camino B) — el adapter está pensado justo para que ese cambio sea
> configuración, no reescritura.
>
> Implementación real: `la-notification/services/channels/whatsapp/providers/evolutionApi.provider.js`.
> El contrato cambió respecto al borrador original: **`sendMessage(to, text)`
> en vez de `sendTemplate(to, templateName, variables)`** — Baileys no pasa
> por la Cloud API oficial de Meta, así que no exige plantillas HSM
> pre-aprobadas (ver `03-plantillas-hsm.md`, que queda en pausa mientras se
> use este provider). El texto final se arma en `templates.js` antes de
> encolar.

## Objetivo

Aislar el envío detrás de un **contrato único** para que cambiar de proveedor sea cambiar
una env var, no reescribir lógica. La selección y aprobación de plantillas, el outbox y la
integración en el dispatcher son agnósticos al provider.

## Contrato (`provider.interface.js`)

```js
/**
 * Todo provider de WhatsApp implementa este contrato.
 */
module.exports = {
  /**
   * Envía una plantilla HSM aprobada.
   * @param {string} to          Teléfono E.164, ej "+5491155555555"
   * @param {string} templateName Nombre de la plantilla aprobada en Meta
   * @param {object} variables    Valores para los placeholders de la plantilla
   * @param {string} [lang]       Locale, default "es_AR"
   * @returns {Promise<{ providerMessageId: string, status: string }>}
   */
  async sendTemplate(to, templateName, variables, lang = 'es_AR') {},

  /**
   * Normaliza el payload del webhook inbound del provider a un formato común.
   * @param {object} body  Body crudo del webhook
   * @returns {Array<{ providerMessageId, status, type, from, text }>}
   *   status: 'sent' | 'delivered' | 'read' | 'failed'
   *   type:   'status' | 'message'   (message = inbound del usuario, ej "STOP")
   */
  parseWebhook(body) {},

  /**
   * Verifica la firma/challenge del webhook (GET verify de Meta, signature de Twilio).
   */
  verifyWebhook(req) {}
};
```

`services/channels/whatsapp/index.js` selecciona el provider según
`process.env.WHATSAPP_PROVIDER` (`meta` | `twilio`).

## Comparación

| Aspecto | **Evolution API / Baileys (elegido)** | Meta Cloud API | Twilio WhatsApp |
|---|---|---|---|
| Costo | Gratis (solo VPS + línea propia) | Solo el de Meta por conversación (sin markup) | Meta + markup Twilio por mensaje |
| Integración | REST self-hosted (Docker) | Directa (HTTP a Graph API) | SDK cómodo, similar a SES |
| Plantillas pre-aprobadas | **No exige** — texto libre | Obligatorias (HSM) | Obligatorias (HSM) |
| Verificación de número (OTP) | Texto libre directo por WhatsApp | Propia o plantilla HSM | `Twilio Verify` lista para usar |
| Webhook inbound | apikey compartida por header | Verify token (GET challenge) | Firma X-Twilio-Signature |
| Riesgo de baneo | **Real** — no es un canal oficial de Meta | Prácticamente nulo si se respetan políticas | Prácticamente nulo (pasa por Meta) |
| Time-to-first-message | Rápida (vincular QR) | Media (setup Business Account + aprobación) | Rápido (sandbox inmediato) |

**Decisión tomada:** **Evolution API** para arrancar — gratis, sin espera de aprobación de
plantillas, apto para el volumen inicial (piloto chico, opt-in explícito). El riesgo de
baneo se mitiga por diseño (opt-in de doble confirmación, opt-out inmediato, límites de
volumen — ver el informe de factibilidad publicado). Si el volumen crece más de lo que
tolera una cuenta Baileys, el camino de escalamiento es Meta Cloud API — el adapter ya está
armado para que ese cambio sea agregar `providers/metaCloud.provider.js` y una env var, no
reescribir el dispatcher.

## Variables de entorno / secrets

A guardar en **AWS Secrets Manager** (`sa-east-1`, ARN en `config/env.js`), no en `.env`
plano:

### Evolution API (elegido — `config/evolution.js`)
```
EVOLUTION_API_URL=...                  # base URL del deployment self-hosted (una instancia de Evolution aloja varias líneas)
EVOLUTION_API_KEY=...                  # apikey del deployment
EVOLUTION_WEBHOOK_APIKEY=...           # para verificar el webhook inbound
```
Sin estas variables el canal queda inactivo (no rompe el arranque del proceso — a propósito,
a diferencia de `config/aws.js` que sí falla rápido si faltan credenciales de SES).

**La línea/número NO es una env var.** Se administra como dato en
`models/WhatsAppInstance.js` (colección `whatsapp-instances`) — permite cargarla recién
cuando exista (sin esperar un deploy) y tener **más de una** (2026-09-13, a pedido: reparte
el volumen de envío entre números y aísla el daño si uno se banea — cada línea igual necesita
su propio warm-up, esto no reemplaza el opt-in/rate-limit de la sección de riesgos). Sin
ninguna instancia con `status:'connected'` y `enabled:true`, los mensajes quedan en el outbox
en `pending` sin gastar reintentos — no es un error, es el estado esperado antes de tener la
primera línea. Alta/gestión: `scripts/whatsappInstances.js` (sin UI admin todavía). La
selección de línea por usuario es determinística (`services/channels/whatsapp/instances.js`,
hash de `userId` sobre las instancias activas) y queda fija en el `WhatsAppOutbox` del primer
envío exitoso, para que los reintentos salgan siempre por el mismo número.

### Meta Cloud API
```
WHATSAPP_PROVIDER=meta
WHATSAPP_META_PHONE_NUMBER_ID=...      # ID del número emisor
WHATSAPP_META_BUSINESS_ACCOUNT_ID=...  # WABA id
WHATSAPP_META_ACCESS_TOKEN=...         # token de larga duración / system user
WHATSAPP_META_WEBHOOK_VERIFY_TOKEN=... # para el GET challenge del webhook
WHATSAPP_META_APP_SECRET=...           # para validar firma de payloads
```

### Twilio
```
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+...     # número habilitado
TWILIO_VERIFY_SERVICE_SID=...          # si se usa Twilio Verify para OTP
```

## Errores y reintentos

- El provider lanza/retorna errores tipificados; el **outbox** decide el retry (no el
  provider). Backoff exponencial sobre `attempts`, tope configurable (ej. 5 intentos).
- Errores no recuperables (número inválido, opt-out, plantilla rechazada) → `failed`
  inmediato sin reintentos, con `failureReason` legible.
- Toda salida se refleja en `NotificationLog` (`method:"whatsapp"`, `status`,
  `delivery.recipientPhone`, `delivery.failureReason`).
