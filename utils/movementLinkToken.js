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
// v2 (2026-07, multi-fuente — mantener en sync con law-analytics-server):
// además de { causaId, userId, url } acepta { source, ref } para movimientos de
// TEXTO sin PDF (scba/eje/mev). Claims: { c, u, url?, s?, m? }. Sin `s` = pjn.
function signMovementToken({ causaId, userId, url, source, ref }) {
  if (!causaId || (!url && !ref)) {
    throw new Error('signMovementToken requiere causaId y url (pjn) o ref (fuentes de texto)');
  }
  const payload = { c: String(causaId), u: userId ? String(userId) : null, url: url ? String(url) : null };
  if (source && source !== 'pjn') {
    payload.s = String(source);
    if (ref) payload.m = String(ref);
  }
  return jwt.sign(payload, getSigningKey(), { algorithm: 'HS256', expiresIn: TOKEN_TTL });
}

module.exports = { signMovementToken };
