const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const logger = require('../config/logger');

/**
 * Eventos del ecosistema que derivan en un aviso al usuario.
 *
 * Hoy: apps MCP conectadas (OAuth 2.1 vía Hydra). El hub llama a este endpoint
 * fire-and-forget al aceptar un consent.
 *
 * Auth: header `X-Internal-Api-Key` (contrato del hub, distinto del Bearer
 * INTERNAL_SERVICE_TOKEN que usan los workers), comparado en tiempo constante.
 * Falla CERRADO: si LA_NOTIFICATION_INTERNAL_API_KEY no está configurada de este
 * lado, se rechaza todo con 503 (PLAN-LANZAMIENTO MCP §3 A4). Antes se aceptaba
 * sin validar — cualquiera podía disparar emails de seguridad a usuarios.
 */
function safeCompare(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual exige mismo largo; el largo de la key no es secreto.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyInternalApiKey(req, res, next) {
  const expected = process.env.LA_NOTIFICATION_INTERNAL_API_KEY;

  if (!expected) {
    logger.error('[Events] LA_NOTIFICATION_INTERNAL_API_KEY no configurada — endpoint interno rechaza todas las llamadas');
    return res.status(503).json({ success: false, message: 'Servicio no configurado' });
  }

  if (!safeCompare(req.header('X-Internal-Api-Key'), expected)) {
    logger.warn(`[Events] Llamada rechazada: X-Internal-Api-Key inválida o ausente (ip=${req.ip}, path=${req.path})`);
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
