# 03 — Plantillas HSM (Highly Structured Messages)

> Las notificaciones del ecosistema son **business-initiated** (las dispara un cron/worker,
> no responden a un mensaje del usuario). Fuera de la ventana de 24 h, WhatsApp **solo
> permite plantillas pre-aprobadas por Meta**. No se puede enviar texto libre.

## Proceso de aprobación

1. Crear las plantillas en **WhatsApp Manager** (Meta) o vía Twilio Content.
2. Categoría: **`UTILITY`** (utilidad) para casi todas — es la más barata y la que mejor se
   aprueba para avisos transaccionales. Evitar `MARKETING` salvo para news/promos.
3. Enviar a aprobación → latencia típica de **horas a días**. **Es el principal bottleneck
   externo del proyecto: arrancar F1 cuanto antes.**
4. Cada plantilla tiene placeholders numerados `{{1}}`, `{{2}}`, … que se completan al envío.
5. Idioma: `es_AR` (con fallback `es`).

## Catálogo propuesto

| `templateName` | Categoría | Notificación | Variables |
|---|---|---|---|
| `otp_verificacion` | AUTHENTICATION | Código OTP de verificación de número (F0) | `{{1}}` código |
| `movimiento_judicial` | UTILITY | Movimiento judicial nuevo | `{{1}}` carátula, `{{2}}` tipo, `{{3}}` fecha, `{{4}}` link |
| `caducidad_expediente` | UTILITY | Aviso de caducidad/prescripción | `{{1}}` carátula, `{{2}}` tipo (caducidad/prescripción), `{{3}}` fecha límite |
| `vencimiento_tarea` | UTILITY | Tarea próxima a vencer | `{{1}}` nombre tarea, `{{2}}` fecha, `{{3}}` prioridad |
| `evento_calendario` | UTILITY | Evento/audiencia próxima | `{{1}}` título, `{{2}}` fecha/hora |
| `seclo_actualizacion` | UTILITY | Solicitud SECLO completada/error | `{{1}}` nº expediente, `{{2}}` estado |

> Para movimientos, **agrupar** los del día por usuario en un solo mensaje cuando sea
> posible (menos conversaciones = menos costo y menos spam). Si son muchos, plantilla con
> "tenés N movimientos nuevos" + link al panel.

## Ejemplo de cuerpo (es_AR)

**`movimiento_judicial`:**
```
⚖️ Nuevo movimiento en tu expediente

*{{1}}*
{{2}} — {{3}}

Ver detalle: {{4}}
```

**`otp_verificacion`** (categoría AUTHENTICATION, con botón copy-code):
```
Tu código de verificación de Law Analytics es {{1}}.
Vence en 10 minutos. No lo compartas.
```

## Mapeo evento → plantilla (`templates.js`)

`services/channels/whatsapp/templates.js` traduce cada tipo de notificación + su payload a
`{ templateName, variables, lang }`. Reutiliza los `templateProcessor`s existentes para
extraer los datos del entity, pero produce **variables planas** (no HTML).

```js
// Borrador
module.exports.buildTemplate = (entityType, payload) => {
  switch (entityType) {
    case 'judicial_movement':
      return {
        templateName: 'movimiento_judicial',
        lang: 'es_AR',
        variables: {
          1: payload.expediente.caratula,
          2: payload.movimiento.tipo,
          3: formatFecha(payload.movimiento.fecha),
          4: payload.movimiento.url || buildPublicLink(payload),
        },
      };
    // ... task, inactivity, event, seclo
  }
};
```

## Consideraciones

- **Links:** usar visor público propio cuando exista (`usePublicMovementLinks` en
  `judicial-notification-config`) en lugar del portal judicial, para mejor UX y tracking.
- **Variables sin saltos de línea ni `{{ }}` accidentales** — Meta rechaza plantillas con
  contenido que parezca formato no permitido.
- **Una plantilla por idioma**; mantener `es_AR` como principal.
- Versionar el catálogo acá cuando se aprueben/cambien plantillas (nombre + estado Meta).
