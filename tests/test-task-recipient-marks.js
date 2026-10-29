/**
 * Marcas de notificación por destinatario de tareas (2026-10-29) — sin DB.
 *
 * Prueba services/taskRecipientMarks.js y su uso en sendTaskBrowserAlerts con
 * un modelo Task falso en memoria (find/updateOne/updateMany mínimos):
 *  1. dos asignados: cada uno recibe su alerta; el segundo no se bloquea por la
 *     marca del primero (corrida completa de sendTaskBrowserAlerts)
 *  2. notifyOnceOnly por destinatario (navegador y email)
 *  3. documento viejo con browserAlertSent: true y sin el campo nuevo: el dueño
 *     no se re-notifica; un asignado nuevo sí, y al marcarlo se siembra la
 *     entrada del dueño con la marca vieja
 *  4. sin notifyOnceOnly: «ya fue hoy» y forceDaily, por destinatario
 *  5. configuración efectiva: individual usa el espejo de la tarea, equipo usa
 *     las preferencias del destinatario
 *  6. los schemas de Task (local y hub) declaran notificationRecipients
 *
 * Uso: node tests/test-task-recipient-marks.js
 */
process.env.NODE_ENV = 'test';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const moment = require('moment');
const logger = require(path.join(__dirname, '..', 'config', 'logger'));
const marks = require(path.join(__dirname, '..', 'services', 'taskRecipientMarks'));
const { sendTaskBrowserAlerts } = require(path.join(__dirname, '..', 'services', 'browser'));

let ok = 0;
let fail = 0;
const test = (titulo, fn) => Promise.resolve().then(fn).then(
  () => { ok++; console.log(`  ✓ ${titulo}`); },
  (err) => { fail++; console.log(`  ✗ ${titulo}\n    ${err && err.stack}`); }
);

const oid = () => new mongoose.Types.ObjectId();
const OWNER = oid();
const A = oid();
const B = oid();
const F = marks.FIELD;
const hoy = moment.utc().format('YYYY-MM-DD');
const ayer = moment.utc().subtract(1, 'day').toDate();
const manana = moment.utc().add(1, 'day').startOf('day').toDate();

// ---------------------------------------------------------------------------
// Modelo Task falso: docs en memoria + los filtros/updates que usa el servicio.
// ---------------------------------------------------------------------------
function fakeTaskModel(docs) {
  const calls = { updateOne: [], updateMany: [], find: 0 };
  const byId = (id) => docs.find((d) => String(d._id) === String(id));
  const clone = (d) => ({ ...d, [F]: Array.isArray(d[F]) ? d[F].map((r) => ({ ...r })) : d[F] });

  // Mismo predicado que buildTaskRecipientFilter evaluaría en Mongo.
  const esDestinatario = (t, uid) => (t.assignedTo || []).some((a) => String(a) === uid)
    || (String(t.userId) === uid && (!t.assignedTo || t.assignedTo.length === 0));

  const matchOne = (d, filter) => {
    if (filter._id && String(d._id) !== String(filter._id)) return false;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '_id') continue;
      if (k === '$or') {
        const okOr = v.some((c) => {
          if (c[F] && c[F].$exists === false) return d[F] === undefined;
          if (c[F] && c[F].$size === 0) return Array.isArray(d[F]) && d[F].length === 0;
          return false;
        });
        if (!okOr) return false;
      } else if (k === `${F}.userId`) {
        const list = d[F] || [];
        if (v && typeof v === 'object' && '$ne' in v) {
          if (list.some((r) => String(r.userId) === String(v.$ne))) return false;
        } else if (!list.some((r) => String(r.userId) === String(v))) return false;
      } else {
        throw new Error(`filtro no soportado por el fake: ${k}`);
      }
    }
    return true;
  };

  const apply = (d, filter, update) => {
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        if (k.startsWith(`${F}.$.`)) {
          const r = d[F].find((x) => String(x.userId) === String(filter[`${F}.userId`]));
          r[k.slice(`${F}.$.`.length)] = v;
        } else d[k] = v;
      }
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        const r = d[F].find((x) => String(x.userId) === String(filter[`${F}.userId`]));
        const f = k.slice(`${F}.$.`.length);
        r[f] = (r[f] || 0) + v;
      }
    }
    if (update.$push) {
      for (const [k, v] of Object.entries(update.$push)) {
        d[k] = d[k] || [];
        d[k].push(v);
      }
    }
  };

  return {
    calls,
    docs,
    find: (q) => {
      calls.find++;
      const uid = String(q.$or[0].assignedTo);
      const rows = docs.filter((d) => esDestinatario(d, uid)).map(clone);
      return { sort: async () => rows };
    },
    updateOne: async (filter, update) => {
      calls.updateOne.push({ filter, update });
      const d = byId(filter._id);
      if (!d || !matchOne(d, filter)) return { matchedCount: 0, modifiedCount: 0 };
      apply(d, filter, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    // Laxo a propósito: aplica $push/$set a los ids pedidos, sin la ventana
    // anti-duplicados de addNotificationAtomic (no es lo que se prueba acá).
    updateMany: async (filter, update) => {
      calls.updateMany.push({ filter, update });
      const ids = (filter._id && filter._id.$in) ? filter._id.$in.map(String) : [];
      let n = 0;
      for (const d of docs) {
        if (!ids.includes(String(d._id))) continue;
        if (filter.notificationSettings && filter.notificationSettings.$exists === false && d.notificationSettings) continue;
        if (filter.notifications && filter.notifications.$exists === false && d.notifications) continue;
        apply(d, filter, update);
        n++;
      }
      return { matchedCount: n, modifiedCount: n };
    }
  };
}

const prefs = (extra = {}) => ({
  notifications: {
    channels: { browser: true, email: true },
    user: { taskExpiration: true, taskExpirationSettings: { notifyOnceOnly: true, daysInAdvance: 5, ...extra } }
  }
});

function fakeModels(TaskModel, usersById) {
  const alerts = [];
  return {
    alerts,
    models: {
      Task: TaskModel,
      User: { findById: async (id) => usersById[String(id)] || null },
      Alert: { create: async (data) => { alerts.push(data); return { _id: oid(), ...data }; } }
    }
  };
}

const tareaEquipo = (extra = {}) => ({
  _id: oid(), name: 'Contestar demanda', userId: OWNER, assignedTo: [A, B],
  status: 'pendiente', checked: false, dueDate: manana, notifications: [], ...extra
});

(async () => {
  await test('1. dos asignados: cada uno recibe su alerta y el segundo no se bloquea por la marca del primero', async () => {
    const t = tareaEquipo();
    const Task = fakeTaskModel([t]);
    const users = { [String(A)]: { _id: A, email: 'a@x', preferences: prefs() }, [String(B)]: { _id: B, email: 'b@x', preferences: prefs() } };
    const { models, alerts } = fakeModels(Task, users);
    const utilities = { logger, mongoose, moment };

    const rA = await sendTaskBrowserAlerts({ userId: A, models, utilities });
    assert.strictEqual(rA.notified, true, rA.message);
    assert.strictEqual(rA.count, 1);
    // La marca vieja quedó puesta (compatibilidad)...
    assert.strictEqual(t.browserAlertSent, true);
    // ...y la nueva es solo de A.
    assert.strictEqual(t[F].length, 1);
    assert.ok(String(t[F][0].userId) === String(A) && t[F][0].browserCount === 1 && t[F][0].browserAlertAt instanceof Date);

    const rB = await sendTaskBrowserAlerts({ userId: B, models, utilities });
    assert.strictEqual(rB.notified, true, `B debía recibir su alerta: ${rB.message}`);
    assert.strictEqual(alerts.length, 2);
    assert.deepStrictEqual(alerts.map((a) => String(a.userId)), [String(A), String(B)]);
    assert.strictEqual(t[F].length, 2);
    assert.strictEqual(String(t[F][1].userId), String(B));

    // Segunda pasada: ninguno se repite (notifyOnceOnly por destinatario).
    assert.strictEqual((await sendTaskBrowserAlerts({ userId: A, models, utilities })).notified, false);
    assert.strictEqual((await sendTaskBrowserAlerts({ userId: B, models, utilities })).notified, false);
    assert.strictEqual(alerts.length, 2);
    assert.strictEqual(t[F][0].browserCount, 1);

    // Equipo: no se espeja la configuración del primero en la tarea.
    assert.strictEqual(t.notificationSettings, undefined);
  });

  await test('2. notifyOnceOnly por destinatario (navegador y email), sin bloquear al otro', async () => {
    const t = tareaEquipo({ [F]: [{ userId: A, browserAlertAt: ayer, browserCount: 1 }] });
    const p = (userId, channel, extra = {}) => marks.shouldNotifyRecipient({ task: t, userId, channel, notifyOnceOnly: true, todayDateString: hoy, ...extra });
    assert.strictEqual(p(A, 'browser'), false);
    assert.strictEqual(p(B, 'browser'), true);
    // El canal es independiente: A todavía no recibió email.
    assert.strictEqual(p(A, 'email'), true);
    // Marca de email para A y verificación.
    const Task = fakeTaskModel([t]);
    const r = await marks.markTaskRecipientNotified(Task, t, A, 'email');
    assert.deepStrictEqual({ updated: r.updated, inserted: r.inserted, seeded: r.seeded }, { updated: true, inserted: false, seeded: false });
    assert.strictEqual(p(A, 'email'), false);
    assert.strictEqual(t[F][0].emailCount, 1);
    assert.strictEqual(p(B, 'email'), true);
    // El dueño no es destinatario (hay asignados), pero si lo fuera tampoco hereda marcas ajenas.
    assert.strictEqual(p(OWNER, 'browser'), true);
    // Con documentos Mongoose hidratados funciona igual (subdocs).
    const TaskModel = require(path.join(__dirname, '..', 'models', 'Task'));
    const doc = new TaskModel({ name: 'x', userId: OWNER, dueDate: manana, assignedTo: [A, B], [F]: [{ userId: A, browserAlertAt: ayer, browserCount: 1 }] });
    assert.strictEqual(marks.shouldNotifyRecipient({ task: doc, userId: A, channel: 'browser', notifyOnceOnly: true, todayDateString: hoy }), false);
    assert.strictEqual(marks.shouldNotifyRecipient({ task: doc, userId: B, channel: 'browser', notifyOnceOnly: true, todayDateString: hoy }), true);
  });

  await test('3. documento viejo (browserAlertSent: true, sin campo nuevo): dueño no se re-notifica; asignado nuevo sí; se siembra al dueño', async () => {
    // Flujo individual (dueño único), como quedó antes del cambio.
    const vieja = {
      _id: oid(), name: 'Vieja', userId: OWNER, status: 'pendiente', checked: false, dueDate: manana,
      browserAlertSent: true, notifications: [{ type: 'browser', date: ayer, success: true }], updatedAt: ayer
    };
    const Task = fakeTaskModel([vieja]);
    const users = { [String(OWNER)]: { _id: OWNER, email: 'o@x', preferences: prefs() }, [String(B)]: { _id: B, email: 'b@x', preferences: prefs() } };
    const { models, alerts } = fakeModels(Task, users);
    const utilities = { logger, mongoose, moment };
    const r = await sendTaskBrowserAlerts({ userId: OWNER, models, utilities });
    assert.strictEqual(r.notified, false, 'el dueño no debía recibir de nuevo');
    assert.strictEqual(alerts.length, 0);
    assert.strictEqual(vieja[F], undefined, 'sin escrituras si no se notifica');

    // Variante sin registro con fecha: solo el flag.
    const soloFlag = { _id: oid(), userId: OWNER, dueDate: manana, browserAlertSent: true, updatedAt: ayer };
    assert.strictEqual(marks.shouldNotifyRecipient({ task: soloFlag, userId: OWNER, channel: 'browser', notifyOnceOnly: true, todayDateString: hoy }), false);
    // Pero por email nunca se le avisó → sí.
    assert.strictEqual(marks.shouldNotifyRecipient({ task: soloFlag, userId: OWNER, channel: 'email', notifyOnceOnly: true, todayDateString: hoy }), true);

    // Ahora el dueño le asigna la tarea a B (y a sí mismo): B nunca la recibió.
    vieja.assignedTo = [OWNER, B];
    const rB = await sendTaskBrowserAlerts({ userId: B, models, utilities });
    assert.strictEqual(rB.notified, true, rB.message);
    assert.strictEqual(alerts.length, 1);
    // Primera escritura sobre documento viejo: entrada del dueño sembrada + la de B.
    assert.strictEqual(vieja[F].length, 2);
    const [sembrada, deB] = vieja[F];
    assert.strictEqual(String(sembrada.userId), String(OWNER));
    assert.strictEqual(sembrada.browserAlertAt.getTime(), ayer.getTime());
    assert.strictEqual(sembrada.browserCount, 1);
    assert.strictEqual(String(deB.userId), String(B));
    // El dueño sigue sin re-notificarse aunque ahora figure como asignado.
    const rO = await sendTaskBrowserAlerts({ userId: OWNER, models, utilities });
    assert.strictEqual(rO.notified, false);
    assert.strictEqual(alerts.length, 1);
  });

  await test('4. sin notifyOnceOnly: «ya fue hoy» y forceDaily se evalúan por destinatario', () => {
    const ahora = new Date();
    const t = tareaEquipo({ [F]: [
      { userId: A, browserAlertAt: ahora, browserCount: 1 },
      { userId: B, browserAlertAt: ayer, browserCount: 1 }
    ] });
    const p = (userId, extra) => marks.shouldNotifyRecipient({ task: t, userId, channel: 'browser', notifyOnceOnly: false, todayDateString: hoy, ...extra });
    assert.strictEqual(p(A), false);                       // ya fue hoy
    assert.strictEqual(p(B), true);                        // ayer → hoy toca
    assert.strictEqual(p(A, { forceDaily: true }), false); // forceDaily no repite en el día
    assert.strictEqual(p(B, { forceDaily: true }), true);
    // Con notifyOnceOnly y forceDaily, B (marcado ayer) igual recibe.
    assert.strictEqual(marks.shouldNotifyRecipient({ task: t, userId: B, channel: 'browser', notifyOnceOnly: true, forceDaily: true, todayDateString: hoy }), true);
  });

  await test('5. configuración efectiva: individual usa el espejo de la tarea; equipo, las preferencias del destinatario', () => {
    const user = { notifyOnceOnly: false, daysInAdvance: 2 };
    const individual = { userId: OWNER, assignedTo: [], notificationSettings: { notifyOnceOnly: true, daysInAdvance: 7 } };
    assert.deepStrictEqual(marks.effectiveRecipientSettings(individual, user), { notifyOnceOnly: true, daysInAdvance: 7 });
    assert.deepStrictEqual(marks.effectiveRecipientSettings({ userId: OWNER }, user), { notifyOnceOnly: false, daysInAdvance: 2 });
    const equipo = { ...individual, assignedTo: [A] };
    assert.deepStrictEqual(marks.effectiveRecipientSettings(equipo, user), { notifyOnceOnly: false, daysInAdvance: 2 });
    // Sin nada: 5 días y notifyOnceOnly falsy, como antes.
    assert.deepStrictEqual(marks.effectiveRecipientSettings({ userId: OWNER }, {}), { notifyOnceOnly: false, daysInAdvance: 5 });
  });

  await test('6. los schemas de Task (local y hub) declaran notificationRecipients con los mismos campos', () => {
    const esperados = ['userId', 'browserAlertAt', 'browserCount', 'emailAt', 'emailCount'];
    const check = (TaskModel, nombre) => {
      const p = TaskModel.schema.path(F);
      assert.ok(p, `${nombre}: Task.${F} no está en el schema`);
      assert.strictEqual(p.instance, 'Array');
      for (const f of esperados) assert.ok(p.schema.path(f), `${nombre}: falta ${F}.${f}`);
      const doc = new TaskModel({ name: 'x', userId: OWNER, dueDate: manana, [F]: [{ userId: A, browserAlertAt: ayer, browserCount: 1 }] });
      const plain = doc.toObject();
      assert.strictEqual(String(plain[F][0].userId), String(A));
      assert.strictEqual(plain[F][0].emailCount, 0);
    };
    check(require(path.join(__dirname, '..', 'models', 'Task')), 'la-notification');
    const hubTask = path.join(__dirname, '..', '..', 'law-analytics-server', 'models', 'Task.js');
    if (fs.existsSync(hubTask)) check(require(hubTask), 'law-analytics-server');
    else console.log('    (hub no disponible en este box: se omite la verificación del hub)');
  });

  console.log(`\n${ok} ok, ${fail} fallidas`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
