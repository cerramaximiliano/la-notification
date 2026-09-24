/**
 * Resumen diario del canal WhatsApp para el reporte al administrador
 * (cron/notificationJobs.js → "Reporte de Movimientos Judiciales").
 * Solo lectura; best-effort: cualquier fallo devuelve lo que se pudo juntar.
 *
 * Alertas (van destacadas en el reporte):
 *  - avisos `failed` / `expired` hoy
 *  - canal encendido sin ninguna línea en rotación (enabled + connected)
 *  - pendientes viejos (>2 h) en el outbox
 *  - plantilla del digest ausente / no aprobada / categorizada como MARKETING
 */

const moment = require('moment-timezone');
const logger = require('../../../config/logger');
const { WhatsAppOutbox, WhatsAppMessage, WhatsAppInstance, User } = require('../../../models');
const policyService = require('../../notificationPolicyService');
const metaTemplates = require('./metaTemplates');

const TZ = 'America/Argentina/Buenos_Aires';
const DIGEST_TYPE = 'judicial_movement_digest';

function countBy(rows, keyFn) {
  const out = {};
  for (const r of rows) { const k = keyFn(r) || 'sin_dato'; out[k] = (out[k] || 0) + (r.count || 1); }
  return out;
}

// Estado de la plantilla del digest vigente (la que elige la admin) en Meta.
async function templateStatus(config) {
  const names = metaTemplates.resolveNames(config);
  const name = names.family ? `${names.family}_1` : names.digest;
  const { templates, error } = await metaTemplates.listTemplates();
  if (error) return { name, status: 'no_consultado', error };
  const t = templates.find(x => x.name === name && (!names.lang || x.language === names.lang)) || templates.find(x => x.name === name);
  return t
    ? { name, status: t.status, category: t.category, rejectedReason: t.rejectedReason, family: names.family || null }
    : { name, status: 'NO_EXISTE', family: names.family || null };
}

async function getDailySummary() {
  const since = moment.tz(TZ).startOf('day').toDate();
  const summary = { since, alerts: [] };
  try {
    const config = await policyService.getConfigCached();
    summary.channelEnabled = policyService.isWhatsappEnabled(config);
    summary.openEnrollment = config?.status?.whatsappOpenEnrollment === true;

    const [outboxRows, failedDocs, stalePending, inboundRows, instances, verifiedUsers, activeUsers] = await Promise.all([
      WhatsAppOutbox.aggregate([
        { $match: { createdAt: { $gte: since }, messageType: { $ne: 'otp' } } },
        { $group: { _id: { type: '$messageType', status: '$status' }, count: { $sum: 1 } } },
      ]),
      WhatsAppOutbox.find({ createdAt: { $gte: since }, status: { $in: ['failed', 'expired'] } })
        .select('messageType status failureReason instanceName').sort({ createdAt: -1 }).limit(5).lean(),
      WhatsAppOutbox.countDocuments({ status: 'pending', createdAt: { $lte: new Date(Date.now() - 2 * 60 * 60 * 1000) } }),
      WhatsAppMessage.aggregate([
        { $match: { receivedAt: { $gte: since } } },
        { $group: { _id: '$handledAs', count: { $sum: 1 } } },
      ]),
      WhatsAppInstance.find({}).select('name provider status enabled wabaId lastConnectionReason dailyLimit').lean(),
      User.countDocuments({ phoneVerified: true }),
      User.countDocuments({ phoneVerified: true, 'preferences.notifications.channels.whatsapp': true, 'whatsappOptIn.accepted': true, 'whatsappOptIn.revokedAt': null }),
    ]);

    const digestRows = outboxRows.filter(r => r._id.type === DIGEST_TYPE);
    const replyRows = outboxRows.filter(r => r._id.type !== DIGEST_TYPE);
    summary.digests = countBy(digestRows.map(r => ({ status: r._id.status, count: r.count })), r => r.status);
    summary.replies = countBy(replyRows.map(r => ({ status: r._id.status, count: r.count })), r => r.status);
    summary.inbound = countBy(inboundRows.map(r => ({ kind: r._id, count: r.count })), r => r.kind);
    summary.failed = failedDocs.map(d => ({ type: d.messageType, status: d.status, reason: d.failureReason || null, instance: d.instanceName || null }));
    summary.stalePending = stalePending;
    summary.instances = instances.map(i => ({ name: i.name, provider: i.provider || 'baileys', status: i.status, enabled: i.enabled !== false, quality: /^quality:/.test(i.lastConnectionReason || '') ? i.lastConnectionReason.slice(8) : null }));
    summary.inRotation = summary.instances.filter(i => i.enabled && i.status === 'connected').length;
    summary.users = { verified: verifiedUsers, active: activeUsers };
    summary.template = await templateStatus(config);

    // ---- alertas ----
    const failedCount = Object.entries({ ...summary.digests, ...{} }).reduce((a, [s, n]) => a + (['failed', 'expired'].includes(s) ? n : 0), 0)
      + Object.entries(summary.replies).reduce((a, [s, n]) => a + (['failed', 'expired'].includes(s) ? n : 0), 0);
    if (failedCount > 0) summary.alerts.push(`${failedCount} mensaje(s) fallidos o vencidos hoy`);
    if (summary.channelEnabled && summary.inRotation === 0) summary.alerts.push('Canal encendido sin ninguna línea en rotación (habilitada + conectada)');
    if (stalePending > 0) summary.alerts.push(`${stalePending} aviso(s) pendientes hace más de 2 h en el outbox`);
    const t = summary.template;
    if (t && ['REJECTED', 'PAUSED', 'DISABLED', 'NO_EXISTE'].includes(t.status)) summary.alerts.push(`Plantilla '${t.name}' ${t.status}${t.rejectedReason && t.rejectedReason !== 'NONE' ? ` (${t.rejectedReason})` : ''}: los avisos fuera de la ventana de 24 h no salen`);
    else if (t && t.status === 'PENDING') summary.alerts.push(t.family
      ? `Plantilla '${t.name}' en revisión: los avisos salen con la de respaldo hasta que Meta la apruebe`
      : `Plantilla '${t.name}' todavía en revisión: fuera de la ventana de 24 h los avisos fallan`);
    if (t && t.category === 'MARKETING') summary.alerts.push(`Plantilla '${t.name}' categorizada como MARKETING (≈5× el costo y con límite por usuario)`);
    for (const i of summary.instances) if (i.quality && /FLAGGED|DOWNGRADE|RESTRICTED/.test(i.quality)) summary.alerts.push(`Calidad de la línea '${i.name}': ${i.quality}`);
  } catch (error) {
    logger.warn(`[WhatsApp report] No se pudo armar el resumen diario: ${error.message}`);
    summary.error = error.message;
  }
  return summary;
}

module.exports = { getDailySummary };
