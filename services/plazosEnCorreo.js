// services/plazosEnCorreo.js — Plazo de vencimiento en el correo de movimientos.
//
// Cuando un movimiento pendiente es una cédula y plazos automáticos ya calculó
// su vencimiento y lo entregó a la carpeta de ESTE usuario, el correo del
// movimiento muestra el plazo. No crea notificaciones nuevas: completa la que ya
// tenemos (JudicialMovement), en el momento de armar el correo.
//
// Fuente: plazos-notificaciones (Atlas, origen 'usuario'). Solo cuenta lo que el
// hub decidió para el usuario (validacion.resultados con accion evento |
// aviso_otra_parte | sugerencia_sin_confirmar); mientras plazos-folders-worker
// esté en dryRun no hay validación y no se muestra nada.
// Contrato y etapas: la-ads/docs/producto/plazos-automaticos.md.
//
// Interruptor: PLAZOS_EN_CORREO=false.

const mongoose = require('mongoose');
const crypto = require('crypto');
const logger = require('../config/logger');

const ACCIONES = new Set(['evento', 'aviso_otra_parte', 'sugerencia_sin_confirmar']);
const RE_CEDULA = /\bC[EÉ]DULA\b/i;

const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const hashDetalle = (d) => crypto.createHash('md5').update(d || '').digest('hex').slice(0, 8);
const claveContenido = (causaId, m) => `${causaId}|${dia(m?.fecha)}|${(m?.tipo || '').trim()}|${hashDetalle((m?.detalle || '').trim())}`;

/**
 * @param {Array} movements — JudicialMovement pendientes del usuario
 * @param {ObjectId|string} userId
 * @returns {Promise<Map<string, object>>} _id del movimiento → plazo a mostrar
 */
async function plazosParaMovimientos(movements, userId) {
  const porMovimiento = new Map();
  if (process.env.PLAZOS_EN_CORREO === 'false') return porMovimiento;

  const cedulas = (movements || []).filter(
    (m) => (!m.source || m.source === 'pjn') && m.expediente?.id && RE_CEDULA.test(m.movimiento?.tipo || '')
  );
  if (!cedulas.length) return porMovimiento;

  try {
    const causaIds = [...new Set(cedulas.map((m) => m.expediente.id))]
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (!causaIds.length) return porMovimiento;

    const plazos = await mongoose.connection.db.collection('plazos-notificaciones')
      .find(
        { origen: 'usuario', causaId: { $in: causaIds }, 'validacion.estado': 'validada' },
        { projection: { causaId: 1, movimiento: 1, plazo: 1, 'validacion.resultados': 1 } }
      )
      .toArray();
    if (!plazos.length) return porMovimiento;

    const porUrl = new Map();
    const porContenido = new Map();
    for (const p of plazos) {
      const causaId = String(p.causaId);
      if (p.movimiento?.url) porUrl.set(`${causaId}|${p.movimiento.url}`, p);
      porContenido.set(claveContenido(causaId, p.movimiento), p);
    }

    const uid = String(userId);
    for (const m of cedulas) {
      const causaId = String(m.expediente.id);
      const p = (m.movimiento?.url && porUrl.get(`${causaId}|${m.movimiento.url}`)) || porContenido.get(claveContenido(causaId, m.movimiento));
      if (!p?.plazo?.vencimiento) continue;
      const r = (p.validacion?.resultados || []).find((x) => String(x.userId) === uid && ACCIONES.has(x.accion));
      if (!r) continue;
      porMovimiento.set(String(m._id), {
        accion: r.accion,
        confirmadoPor: r.confirmadoPor || null,
        vencimiento: p.plazo.vencimiento,
        vencimientoConGracia: p.plazo.vencimientoConGracia || null,
        plazoDias: p.plazo.plazoDias ?? null,
        tipoPlazo: p.plazo.tipoPlazo || null,
        fuente: p.plazo.fuente || null,
        norma: p.plazo.norma ? { label: p.plazo.norma.label || null, cita: p.plazo.norma.cita || null } : null,
      });
    }
    if (porMovimiento.size) logger.info(`[plazos-en-correo] usuario ${uid}: ${porMovimiento.size} movimiento(s) con plazo`);
  } catch (err) {
    // Nunca frena el correo: sin plazo, el movimiento se notifica igual.
    logger.warn(`[plazos-en-correo] ${err.message}`);
  }
  return porMovimiento;
}

module.exports = { plazosParaMovimientos };
