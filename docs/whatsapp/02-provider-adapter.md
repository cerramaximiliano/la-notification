# 02 — Provider adapter: Meta Cloud API (principal) + Evolution API (respaldo)

> **Actualizado 2026-09-14**: **Meta Cloud API pasa a ser el provider principal**
> (el 13 se había arrancado por Evolution/Baileys). Motivos: el costo por aviso
> (~US$0,012 utility en AR) es asumible, las conversaciones iniciadas por el
> usuario son gratis (ventana de 24 h, texto libre) y habilitan el bot
> conversacional que se quiere a futuro, y un bot automatizado sobre Baileys es
> motivo de baneo. Evolution queda como respaldo/dev (sigue corriendo en
> worker-cloud-02).
>
> Implementación: `providers/metaCloud.provider.js` (Graph API directa),
> `providers/evolutionApi.provider.js`, y el despachador `providers/index.js`
> (`sendViaInstance(instance, to, text, { templateParams })`) que elige por
> `WhatsAppInstance.provider`. Meta: dentro de la ventana de 24 h manda texto
> libre; fuera, la plantilla utility `movimientos_carpetas` con `templateParams`
> (una línea, sin saltos — `templates.buildMovementDigestTemplateParams`); sin
> ventana ni plantilla → error permanente. La ventana se sigue por contacto en
> `whatsapp-contacts.lastInboundAt`. Webhook de Meta: `routes/whatsappMetaWebhook.js`
> (`GET` challenge + `POST` firmado con `X-Hub-Signature-256`; `app.js` guarda
> `req.rawBody`). Verificación del número por **mensaje entrante** (link `wa.me`
> con `VERIFICAR-<código>` → el hub lo confirma vía `POST /api/internal/phone/confirm-inbound`).
> Mensajes entrantes guardados en `whatsapp-messages`.

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

### Meta Cloud API (principal — `config/meta.js`)
```
WHATSAPP_META_ACCESS_TOKEN=...         # token de system user (permanente) o temporal del panel
WHATSAPP_META_APP_SECRET=...           # firma X-Hub-Signature-256 del webhook (fail-closed)
WHATSAPP_META_WEBHOOK_VERIFY_TOKEN=... # string propio para el GET de verificación
WHATSAPP_META_GRAPH_VERSION=v22.0      # opcional
WHATSAPP_META_TEMPLATE_DIGEST=movimientos_carpetas   # plantilla utility aprobada
WHATSAPP_META_TEMPLATE_LANG=es_AR
```
El `phoneNumberId` (y `wabaId`) NO es env: se registra por línea en `whatsapp-instances`
(`provider:'meta'`) desde la admin ("Vincular línea nueva" → Meta) o con
`node scripts/whatsappInstances.js add-meta <name> <phoneNumberId> [label] [+número]`, que
valida el número contra Graph y lo deja `connected`.

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
