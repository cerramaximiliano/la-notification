/**
 * Envío de PRUEBA del email de bandeja (notificaciones + movimientos) a un
 * usuario, usando el código real (procesadores + template del archivo fuente) y
 * los datos reales de pjn-notifications + JudicialMovement pendientes.
 *
 * NO toca el template de la DB ni marca nada como notificado: es un preview real
 * en el inbox, seguro para correr antes de deployar.
 *
 * USO: node scripts/test-send-bandeja-email.js --email cerramaximiliano@gmail.com
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { sendEmail } = require('../services/email');
const tpl = require('../templates/judicial-movement-template');
const {
  processTemplate, processJudicialMovementsData, processJudicialCedulasData, sectionHeaderHtml
} = require('../services/templateProcessor');
const JudicialMovement = require('../models/JudicialMovement');

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function deriveFuero(exp) {
  if (exp && typeof exp.numeracion === 'string') {
    const t = exp.numeracion.trim().split(/\s+/)[0];
    if (t) return t;
  }
  return (exp && exp.camara) || 'PJN';
}

async function main() {
  const email = arg('--email', 'cerramaximiliano@gmail.com');
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(process.env.URLDB);
  const db = mongoose.connection.db;

  const user = await db.collection('usuarios').findOne(
    { email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
  );
  if (!user) throw new Error(`Usuario ${email} no encontrado`);
  console.log(`Usuario: ${user.email} (${user._id})`);

  // Cédulas reales del usuario desde pjn-notifications.
  const notifDocs = await db.collection('pjn-notifications')
    .find({ userId: user._id }).sort({ fecha: -1 }).limit(50).toArray();

  const cedulasByExpediente = {};
  for (const d of notifDocs) {
    const exp = d.expediente || {};
    const key = exp.id != null ? String(exp.id) : `n${d.sourceId}`;
    if (!cedulasByExpediente[key]) {
      cedulasByExpediente[key] = {
        expediente: {
          id: key,
          number: exp.numero,
          year: exp.anio,
          fuero: deriveFuero(exp),
          caratula: exp.caratula || '(sin carátula)'
        },
        cedulas: []
      };
    }
    cedulasByExpediente[key].cedulas.push({
      cedula: {
        fecha: d.fecha ? new Date(d.fecha) : new Date(d.createdAt),
        tipo: 'Cédula',
        numeroCedula: d.numeroCedula,
        oficina: (d.oficina && d.oficina.descripcion) || exp.oficina || null
      }
    });
  }

  // Movimientos reales pendientes (si hay).
  const pendingMovements = await JudicialMovement.find({ userId: user._id, notificationStatus: 'pending' })
    .sort({ 'movimiento.fecha': -1 }).limit(50);
  const movementsByExpediente = {};
  pendingMovements.forEach(m => {
    const key = m.expediente.id || `${m.expediente.number}/${m.expediente.year ?? ''}`;
    if (!movementsByExpediente[key]) movementsByExpediente[key] = { expediente: m.expediente, movements: [] };
    movementsByExpediente[key].movements.push(m);
  });

  // Armar variables igual que sendJudicialMovementNotifications.
  const userForTpl = { name: user.name || user.firstName || user.email, email: user.email };
  const movementVars = processJudicialMovementsData(movementsByExpediente, userForTpl, {});
  const cedulaData = processJudicialCedulasData(cedulasByExpediente);

  const movKeys = Object.keys(movementsByExpediente);
  const cedKeys = cedulaData.cedulasExpedienteKeys;
  const totalExpedientesCount = new Set([...movKeys, ...cedKeys]).size;
  const hasMov = movKeys.length > 0, hasCed = cedKeys.length > 0;

  let novedadLabel, tituloPrincipal, ledeText;
  if (hasMov && hasCed) {
    novedadLabel = 'Nuevas novedades'; tituloPrincipal = 'Tenés nuevas novedades';
    ledeText = `tenés notificaciones nuevas y movimientos en ${totalExpedientesCount} expediente(s). Acá tenés el detalle.`;
  } else if (hasCed) {
    novedadLabel = 'Nuevas notificaciones'; tituloPrincipal = 'Tenés nuevas notificaciones';
    ledeText = `recibiste notificaciones nuevas en ${totalExpedientesCount} expediente(s). Acá tenés el detalle.`;
  } else {
    novedadLabel = 'Nuevos movimientos'; tituloPrincipal = 'Tenés nuevos movimientos';
    ledeText = `se registraron movimientos nuevos en ${totalExpedientesCount} expediente(s). Acá tenés el detalle.`;
  }

  const vars = {
    ...movementVars,
    cedulasHtml: cedulaData.cedulasHtml,
    cedulasText: cedulaData.cedulasText,
    novedadLabel, tituloPrincipal, ledeText, totalExpedientesCount,
    movimientosHeader: (hasMov && hasCed) ? sectionHeaderHtml('Movimientos') : '',
    movimientosHeaderText: (hasMov && hasCed) ? 'MOVIMIENTOS\n' : ''
  };

  const subject = processTemplate(tpl.subject, vars);
  const html = processTemplate(tpl.htmlContent, vars);
  const text = processTemplate(tpl.textContent, vars);

  console.log(`\nCédulas: ${notifDocs.length} | Movimientos pendientes: ${pendingMovements.length}`);
  console.log(`SUBJECT: ${subject}`);
  console.log(`Destino: ${user.email}`);

  const outPath = arg('--out', null);
  if (outPath) {
    require('fs').writeFileSync(outPath, html);
    console.log(`HTML escrito en ${outPath}`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] no se envía.');
  } else {
    await sendEmail(user.email, subject, html, text);
    console.log('\n✅ Email enviado.');
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
