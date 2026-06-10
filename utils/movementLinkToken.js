// utils/movementLinkToken.js
//
// Firma del token de los links "Ver documento" de los emails de movimientos
// (vista pública /m/:token servida por law-analytics-front + law-analytics-server).
//
// IMPORTANTE: este archivo debe quedar EN SYNC con
// law-analytics-server/utils/movementLinkToken.js — mismo DERIVE_LABEL, mismo
// payload y mismo TTL, o el server no podrá verificar lo que firmamos acá.
//
// El token es un JWT HS256 firmado con una CLAVE DERIVADA del JWT_SECRET
// compartido por el ecosistema:
//
//     key = HMAC_SHA256(JWT_SECRET, "movement-link-v1")
//
// Derivar (en vez de usar JWT_SECRET directo) aísla este token del JWT de
// sesión. No requiere secreto nuevo: la-notification y law-analytics-server ya
// comparten JWT_SECRET (acá se usa en services/websocket.js).
//
// Payload: { c: causaId, u: userId, url: movementUrl }. El server resuelve el
// PjnMovement con (causaId, url). userId es atribución/CTA, NO control de acceso
// (el acceso lo da la posesión del token firmado — modelo capability-URL).

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const DERIVE_LABEL = 'movement-link-v1';
const TOKEN_TTL = '90d';

function getSigningKey() {
  const base = process.env.JWT_SECRET;
  if (!base) {
    throw new Error('JWT_SECRET no está definido — no se puede firmar el movement-link token');
  }
  return crypto.createHmac('sha256', base).update(DERIVE_LABEL).digest('hex');
}

// Firma un token para un movimiento. { causaId, userId, url } -> string JWT.
function signMovementToken({ causaId, userId, url }) {
  if (!causaId || !url) {
    throw new Error('signMovementToken requiere causaId y url');
  }
  return jwt.sign(
    { c: String(causaId), u: userId ? String(userId) : null, url: String(url) },
    getSigningKey(),
    { algorithm: 'HS256', expiresIn: TOKEN_TTL }
  );
}

module.exports = { signMovementToken };
