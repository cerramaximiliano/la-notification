const express = require('express');
const router = express.Router();
const logger = require('../config/logger');

/**
 * Eventos del ecosistema que derivan en un aviso al usuario.
 *
 * Hoy: apps MCP conectadas (OAuth 2.1 vía Hydra). El hub llama a este endpoint
 * fire-and-forget al aceptar un consent; hasta ahora no existía y las llamadas
 * morían en un 404 silencioso.
 *
 * Auth: header `X-Internal-Api-Key` (contrato del hub, distinto del Bearer
 * INTERNAL_SERVICE_TOKEN que usan los workers). Si la key no está configurada
 * de este lado, se acepta la llamada pero se deja constancia en el log — MCP
 * está en desarrollo y no queremos que el aviso se pierda por un secret que
 * todavía no se propagó.
 */
function verifyInternalApiKey(req, res, next) {
  const expected = process.env.LA_NOTIFICATION_INTERNAL_API_KEY;

  if (!expected) {
    logger.warn('[Events] LA_NOTIFICATION_INTERNAL_API_KEY no configurada — se acepta la llamada sin validar');
    return next();
  }

  const provided = req.header('X-Internal-Api-Key');
  if (!provided || provided !== expected) {
    logger.warn('[Events] Llamada rechazada: X-Internal-Api-Key inválida o ausente');
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }

  return next();
}

/**
 * POST /api/events/mcp-app-connected
 *
 * Body (contrato del hub — snake_case):
 *   { user_id, user_email, client_id, client_name, connected_at, ip, user_agent, revoke_url }
 *
 * Envía un aviso de seguridad al usuario: "conectaste una aplicación a tu
 * cuenta", con el detalle de la app y el link para revocar el acceso.
 */
router.post('/mcp-app-connected', verifyInternalApiKey, async (req, res) => {
  try {
    const {
      user_id: userId,
      user_email: userEmail,
      client_name: clientName,
      client_id: clientId,
      connected_at: connectedAt,
      ip,
      user_agent: userAgent,
      revoke_url: revokeUrl
    } = req.body || {};

    if (!userId && !userEmail) {
      return res.status(400).json({ success: false, message: 'Se requiere user_id o user_email' });
    }

    const { sendMcpAppConnectedNotification } = require('../services/notifications');
    const result = await sendMcpAppConnectedNotification({
      userId,
      userEmail,
      clientName,
      clientId,
      connectedAt,
      ip,
      userAgent,
      revokeUrl
    });

    return res.json({
      success: result.success !== false,
      sent: result.sent === true,
      message: result.message
    });

  } catch (error) {
    logger.error(`[Events] Error procesando mcp-app-connected: ${error.message}`);
    return res.status(500).json({ success: false, sent: false, message: error.message });
  }
});

module.exports = router;
