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
 * Auth: Bearer INTERNAL_SERVICE_TOKEN (convención del ecosistema) o header
 * `X-Internal-Api-Key` (contrato original del hub), en tiempo constante.
 * Falla CERRADO: si no hay ninguna credencial configurada de este lado, se
 * rechaza todo con 503 (PLAN-LANZAMIENTO MCP §3 A4). Antes se aceptaba sin
 * validar — cualquiera podía disparar emails de seguridad a usuarios.
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
  // Dos credenciales aceptadas:
  //  - Bearer INTERNAL_SERVICE_TOKEN: convención del ecosistema para hablarle a
  //    la-notification (workers, postal-tracking, hub). Viene de env-8tdon8.
  //  - X-Internal-Api-Key = LA_NOTIFICATION_INTERNAL_API_KEY: contrato original
  //    del hub para este endpoint; se mantiene por compatibilidad.
  const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
  const apiKey = process.env.LA_NOTIFICATION_INTERNAL_API_KEY;

  if (!serviceToken && !apiKey) {
    logger.error('[Events] Ni INTERNAL_SERVICE_TOKEN ni LA_NOTIFICATION_INTERNAL_API_KEY configurados — endpoint interno rechaza todas las llamadas');
    return res.status(503).json({ success: false, message: 'Servicio no configurado' });
  }

  const authHeader = req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  const ok =
    (serviceToken && bearer && safeCompare(bearer, serviceToken)) ||
    (apiKey && safeCompare(req.header('X-Internal-Api-Key'), apiKey));

  if (!ok) {
    logger.warn(`[Events] Llamada rechazada: credencial interna inválida o ausente (ip=${req.ip}, path=${req.path})`);
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }

  return next();
}

const DEFAULT_REVOKE_URL = 'https://lawanalytics.app/settings/connected-apps';

function isTrustedRevokeUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'lawanalytics.app';
  } catch (_err) {
    return false;
  }
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
      revoke_url: rawRevokeUrl
    } = req.body || {};

    // El link va dentro de un mail de seguridad: solo se acepta el dominio propio.
    const revokeUrl = isTrustedRevokeUrl(rawRevokeUrl) ? rawRevokeUrl : DEFAULT_REVOKE_URL;

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
