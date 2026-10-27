# Push a la app mobile (FCM)

Canal `services/channels/push/index.js`. Se dispara al crear cada `Alert` (`pushAlert`) desde los flujos de
movimientos judiciales, eventos, tareas y alertas custom. Lee los tokens de `device-tokens` (los escribe el hub,
`POST /api/mobile/devices`) y respeta `preferences.notifications.channels.mobile`.

## Qué significa cada línea del log

| Log | Significado |
|---|---|
| `Push: Firebase inicializado` | `FIREBASE_SERVICE_ACCOUNT` OK (aparece al primer envío tras un reinicio). |
| `Push: sin FIREBASE_SERVICE_ACCOUNT…` | Canal apagado (no-op). |
| `Push enviada a N dispositivo(s) del usuario X` | FCM **aceptó** N tokens. **No** prueba entrega: FCM acepta tokens de instalaciones viejas que ya no reciben nada. |
| `Push: fallo enviando…` | Error distinto de token inválido (se loguea y sigue). |

Los tokens que FCM rechaza (`registration-token-not-registered`, `invalid-registration-token`) se borran. Desde
2026-10-23 el hub además deja un solo token por `deviceId`.

## Incidente 2026-10-23

Las push "salían" (`Push enviada a 17 dispositivo(s)`) pero no llegaban a ningún teléfono: la app 0.12.1–0.12.5
(R8) no creaba sus canales ni registraba el token, y los 17 tokens eran de instalaciones anteriores. El servidor
estaba bien. Arreglo en la app 0.12.6 + hub `f117d96`. Diagnóstico y forma de probar una push real en
`la-mobile/docs/06-release-y-firma.md` § Notificaciones push.

## Cuándo sale la push de un movimiento nuevo

- `judicialMovementNotificationJob` corre según `NOTIFICATION_JUDICIAL_MOVEMENT_CRON` (en producción `*/30 * * * *`,
  el default del código es `*/15`). Un reinicio del proceso justo en el minuto de la corrida la saltea.
- Toma `judicialmovements` `pending` con `notifyAt <= now`, o todos los del usuario si está en modo `immediate`
  (menos los diferidos con `notificationSettings.deferred: true`, que esperan su `notifyAt` — fix 2026-10-27,
  ver `JUDICIAL_MOVEMENTS_FLOW.md`).
- **Un aviso por causa y por día, día en hora argentina** ("Una notificación por causa y día: N movimientos
  diferidos…"); días no activos (fin de semana) pasan al próximo día activo.
- Para ver una corrida: `sudo grep "^<fecha> HH:MM" /var/www/la-notification/logs/pm2-out.log` en worker-003.
