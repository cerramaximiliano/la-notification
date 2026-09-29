#!/usr/bin/env node

/**
 * Prueba SIN base de datos del banner de estado "Credencial PJN requiere
 * acción" (services/emailBanners.js).
 *
 * Stubea el config doc (policyService), los modelos que consulta el banner de
 * plan (Folder / PlanBannerSend) y la sugerencia de plan, así resolveEmailBanners
 * corre completo contra un user fake sin tocar Mongo.
 *
 *   node tests/test-credential-banner.js
 */

process.env.FRONT_BASE_URL = 'https://www.lawanalytics.app';

const assert = require('assert');

// Stubs ANTES de cargar emailBanners (lee estos módulos en cada llamada).
const policyService = require('../services/notificationPolicyService');
const models = require('../models');
const planSuggestion = require('../services/planSuggestion');

let CONFIG = {};
policyService.getConfigCached = async () => CONFIG;
models.Folder.countDocuments = async (q) => (q && q.archived === true ? 2 : 5);
models.PlanBannerSend.exists = async () => null;
models.PlanBannerSend.create = async () => { throw new Error('la prueba no debe registrar banner-sends'); };
planSuggestion.suggestPlanUpgrade = async () => ({
  archivedCount: 2,
  totalNeeded: 7,
  coversAll: true,
  current: { planId: 'free', displayName: 'Plan Gratuito', folderLimit: 5 },
  suggested: { planId: 'standard', displayName: 'Plan Estándar', folderLimit: 50, price: 10, currency: 'USD' }
});

const { buildCredentialBanner, resolveEmailBanners, applyBannerFallback, credentialBannerAllowedForType, CREDENTIAL_BANNER_DEFAULT_TYPES } = require('../services/emailBanners');
const { processTemplate } = require('../services/templateProcessor');

const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m' };
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

const USER_ID = '68c1a196f8de85c63ba999f0';
const TITLE = 'Tu credencial PJN requiere acción';
const CTA_LABEL = 'Actualizar credencial';
const CTA_URL_MOV = 'https://www.lawanalytics.app/apps/profiles/account/pjn?source=email_movimiento_credencial';

// Config "abierta": plan, feature y gcal habilitados y sin cooldown compartido,
// con los overrides que permitirían apilarlos → si feature/gcal no salen es
// SOLO por el banner de credencial.
const CONFIG_ABIERTA = {
  planBanner: { enabled: true },
  featureBanner: { enabled: true, title: 'Novedad de prueba', text: 'Texto de la novedad', showWithPlanBanner: true },
  googleCalendarBanner: { enabled: true, showWithOtherBanners: true },
  notificationOptionsBanner: { enabled: true },
  bannerPolicy: { sharedCooldown: { enabled: false } }
};

function userFake(state) {
  return {
    _id: USER_ID,
    email: 'prueba@lawanalytics.app',
    googleCalendarConnected: false,
    pjnCredentialState: state
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---- buildCredentialBanner directo ----
test('buildCredentialBanner: requiresAction true → título, CTA, URL del perfil PJN y fecha dd/mm/aaaa (ART)', () => {
  // 27/09 23:30 ART = 28/09 02:30 UTC → tiene que salir 27/09/2026
  const b = buildCredentialBanner(userFake({ requiresAction: true, since: new Date('2026-09-28T02:30:00Z') }), 'https://www.lawanalytics.app', 'movimiento');
  assert.ok(b.html.includes('<!--credential-banner-->'), 'marker');
  assert.ok(b.html.includes(TITLE), 'título html');
  assert.ok(b.html.includes(CTA_LABEL), 'CTA html');
  assert.ok(b.html.includes(CTA_URL_MOV), 'URL html');
  assert.ok(b.html.includes('el 27/09/2026.'), 'fecha html en ART');
  assert.ok(b.html.includes('causas públicas'), 'copy públicas');
  assert.ok(b.text.includes(TITLE), 'título text');
  assert.ok(b.text.includes(`${CTA_LABEL}: ${CTA_URL_MOV}`), 'CTA text');
  assert.ok(b.text.includes('27/09/2026'), 'fecha text');
  assert.ok(!b.html.includes('$'), 'sin $ (processTemplate usa String.replace)');
});

test('buildCredentialBanner: requiresAction false / undefined / user null → vacío', () => {
  for (const u of [userFake({ requiresAction: false, since: new Date() }), userFake(undefined), userFake({}), null, {}]) {
    const b = buildCredentialBanner(u, 'https://www.lawanalytics.app', 'movimiento');
    assert.strictEqual(b.html, '');
    assert.strictEqual(b.text, '');
  }
});

test('buildCredentialBanner: sin since (o inválida) → texto sin fecha, sin "undefined"', () => {
  for (const since of [null, undefined, 'no-es-fecha']) {
    const b = buildCredentialBanner(userFake({ requiresAction: true, since }), 'https://www.lawanalytics.app', 'tareas');
    assert.ok(b.html.includes('rechazó tu contraseña. Te seguimos'), 'sin fecha');
    assert.ok(!/undefined|null|Invalid/.test(b.html), 'sin basura');
    assert.ok(b.html.includes('source=email_tareas_credencial'), 'source por tipo de correo');
  }
});

test('buildCredentialBanner: since como string ISO y como Date dan la misma fecha', () => {
  const a = buildCredentialBanner(userFake({ requiresAction: true, since: '2026-09-27T15:00:00.000Z' }), null, 'calendario');
  const b = buildCredentialBanner(userFake({ requiresAction: true, since: new Date('2026-09-27T15:00:00.000Z') }), null, 'calendario');
  assert.ok(a.html.includes('27/09/2026'));
  assert.strictEqual(a.html, b.html);
  assert.ok(a.html.includes('https://www.lawanalytics.app/apps/profiles/account/pjn'), 'base por default');
});

test('buildCredentialBanner: doc de Mongoose hidratado (como devuelve User.findById) → lee pjnCredentialState del schema', () => {
  // User.hydrate simula el doc que devuelve findById: sin el campo declarado
  // en models/User.js el schema strict lo descartaría y el banner no saldría.
  const doc = models.User.hydrate({
    _id: USER_ID,
    email: 'prueba@lawanalytics.app',
    pjnCredentialState: { requiresAction: true, reason: 'credential_invalid', since: new Date('2026-09-27T12:00:00Z') }
  });
  assert.strictEqual(doc.pjnCredentialState.requiresAction, true, 'campo declarado en el schema');
  const b = buildCredentialBanner(doc, 'https://www.lawanalytics.app', 'movimiento');
  assert.ok(b.html.includes(TITLE) && b.html.includes('27/09/2026'), 'banner desde doc hidratado');
  // Doc viejo sin el campo: default requiresAction=false → vacío.
  const viejo = models.User.hydrate({ _id: USER_ID, email: 'viejo@lawanalytics.app' });
  assert.strictEqual(viejo.pjnCredentialState.requiresAction, false);
  assert.strictEqual(buildCredentialBanner(viejo, null, 'movimiento').html, '');
});

// ---- resolveEmailBanners ----
test('resolveEmailBanners: requiresAction true → credencial + plan presentes, feature y gcal suprimidos, options se mantiene', async () => {
  CONFIG = CONFIG_ABIERTA;
  const user = userFake({ requiresAction: true, reason: 'credential_invalid', since: new Date('2026-09-27T12:00:00Z') });
  const r = await resolveEmailBanners(USER_ID, user, { sourceEmail: 'movimiento' });
  const v = r.templateVars;
  assert.strictEqual(r.credentialBannerShown, true);
  assert.ok(v.credentialBannerHtml.includes(TITLE) && v.credentialBannerHtml.includes(CTA_URL_MOV) && v.credentialBannerHtml.includes('27/09/2026'), 'credencial html');
  assert.ok(v.credentialBannerText.includes(TITLE) && v.credentialBannerText.includes(CTA_URL_MOV), 'credencial text');
  assert.strictEqual(r.planBannerShown, true, 'plan se mantiene');
  assert.ok(v.planBannerHtml.includes('<!--plan-banner-->'), 'plan html');
  assert.strictEqual(v.featureBannerHtml, '', 'feature suprimido');
  assert.strictEqual(v.featureBannerText, '', 'feature text suprimido');
  assert.strictEqual(v.gcalBannerHtml, '', 'gcal suprimido');
  assert.strictEqual(v.gcalBannerText, '', 'gcal text suprimido');
  assert.ok(v.optionsBannerHtml.includes('<!--options-banner-->'), 'options se mantiene');
});

test('resolveEmailBanners (control): misma config con requiresAction false → sin credencial, feature y gcal SÍ salen', async () => {
  CONFIG = CONFIG_ABIERTA;
  const r = await resolveEmailBanners(USER_ID, userFake({ requiresAction: false }), { sourceEmail: 'movimiento' });
  const v = r.templateVars;
  assert.strictEqual(r.credentialBannerShown, false);
  assert.strictEqual(v.credentialBannerHtml, '');
  assert.strictEqual(v.credentialBannerText, '');
  assert.strictEqual(r.planBannerShown, true);
  assert.ok(v.featureBannerHtml.includes('<!--feature-banner-->'), 'feature sale sin credencial');
  assert.ok(v.gcalBannerHtml.includes('<!--gcal-banner-->'), 'gcal sale sin credencial');
});

test('resolveEmailBanners: user sin el campo (doc viejo) → slot vacío', async () => {
  CONFIG = CONFIG_ABIERTA;
  const r = await resolveEmailBanners(USER_ID, userFake(undefined), { sourceEmail: 'vencimiento' });
  assert.strictEqual(r.credentialBannerShown, false);
  assert.strictEqual(r.templateVars.credentialBannerHtml, '');
});

test('resolveEmailBanners: kill-switch credentialBanner.enabled=false → no sale aunque requiresAction', async () => {
  CONFIG = { ...CONFIG_ABIERTA, credentialBanner: { enabled: false } };
  const r = await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date() }), { sourceEmail: 'movimiento' });
  assert.strictEqual(r.credentialBannerShown, false);
  assert.strictEqual(r.templateVars.credentialBannerHtml, '');
  assert.ok(r.templateVars.featureBannerHtml.includes('<!--feature-banner-->'), 'feature vuelve a salir');
});

test('resolveEmailBanners: sin config (null) → el banner de credencial sale igual en el correo de movimientos', async () => {
  CONFIG = null;
  const r = await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date('2026-09-20T12:00:00Z') }), { sourceEmail: 'movimiento' });
  assert.strictEqual(r.credentialBannerShown, true);
  assert.ok(r.templateVars.credentialBannerHtml.includes('20/09/2026'));
  assert.ok(r.templateVars.credentialBannerHtml.includes('source=email_movimiento_credencial'));
});

test('resolveEmailBanners: por default SOLO en el correo de movimientos (vencimiento, calendario, tareas, inactividad, postal → sin banner)', async () => {
  // Sin emailTypes, con emailTypes vacío (default del schema) y sin nodo credentialBanner.
  for (const credentialBanner of [undefined, { enabled: true }, { enabled: true, emailTypes: [] }]) {
    CONFIG = credentialBanner ? { ...CONFIG_ABIERTA, credentialBanner } : CONFIG_ABIERTA;
    const mov = await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date() }), { sourceEmail: 'movimiento' });
    assert.strictEqual(mov.credentialBannerShown, true, 'movimiento');
    assert.ok(mov.templateVars.credentialBannerHtml.includes('source=email_movimiento_credencial'), 'movimiento');
    for (const sourceEmail of ['vencimiento', 'calendario', 'tareas', 'inactividad', 'postal', 'postal_admin', 'notificacion']) {
      const r = await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date() }), { sourceEmail });
      assert.strictEqual(r.credentialBannerShown, false, sourceEmail);
      assert.strictEqual(r.templateVars.credentialBannerHtml, '', sourceEmail);
      assert.strictEqual(r.templateVars.credentialBannerText, '', sourceEmail);
      // Sin banner de credencial, feature y gcal vuelven a salir en esos correos.
      assert.ok(r.templateVars.featureBannerHtml.includes('<!--feature-banner-->'), `feature en ${sourceEmail}`);
    }
  }
});

test('resolveEmailBanners: con credentialBanner.emailTypes explícito se respeta (amplía a otros tipos o quita movimiento)', async () => {
  CONFIG = { ...CONFIG_ABIERTA, credentialBanner: { enabled: true, emailTypes: ['movimiento', 'calendario'] } };
  for (const sourceEmail of ['movimiento', 'calendario']) {
    const r = await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date() }), { sourceEmail });
    assert.strictEqual(r.credentialBannerShown, true, sourceEmail);
    assert.ok(r.templateVars.credentialBannerHtml.includes(`source=email_${sourceEmail}_credencial`), sourceEmail);
  }
  for (const sourceEmail of ['vencimiento', 'tareas', 'postal']) {
    const r = await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date() }), { sourceEmail });
    assert.strictEqual(r.credentialBannerShown, false, sourceEmail);
  }
  // Explícito SIN movimiento: también se respeta (el default no se suma).
  CONFIG = { ...CONFIG_ABIERTA, credentialBanner: { enabled: true, emailTypes: ['tareas'] } };
  assert.strictEqual((await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date() }), { sourceEmail: 'movimiento' })).credentialBannerShown, false, 'movimiento fuera del explícito');
  assert.strictEqual((await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date() }), { sourceEmail: 'tareas' })).credentialBannerShown, true, 'tareas explícito');
});

test('credentialBannerAllowedForType: default solo movimiento; emailTypes vacío = default; explícito se respeta', () => {
  assert.deepStrictEqual(CREDENTIAL_BANNER_DEFAULT_TYPES, ['movimiento']);
  assert.strictEqual(credentialBannerAllowedForType(undefined, 'movimiento'), true);
  assert.strictEqual(credentialBannerAllowedForType({}, 'movimiento'), true);
  assert.strictEqual(credentialBannerAllowedForType({ emailTypes: [] }, 'movimiento'), true);
  assert.strictEqual(credentialBannerAllowedForType({}, 'calendario'), false);
  assert.strictEqual(credentialBannerAllowedForType({ emailTypes: [] }, 'calendario'), false);
  assert.strictEqual(credentialBannerAllowedForType({ emailTypes: ['calendario'] }, 'calendario'), true);
  assert.strictEqual(credentialBannerAllowedForType({ emailTypes: ['calendario'] }, 'movimiento'), false);
});

// ---- applyBannerFallback ----
test('applyBannerFallback: plantilla SIN slot → se inyecta antes de </body> (credencial antes que plan) y el texto una sola vez', async () => {
  CONFIG = CONFIG_ABIERTA;
  const banners = await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date('2026-09-27T12:00:00Z') }), { sourceEmail: 'movimiento' });
  const html = '<html><body><p>Cuerpo del correo</p></body></html>';
  const text = 'Cuerpo del correo\n';
  const out = applyBannerFallback(html, text, banners);
  assert.ok(out.htmlContent.includes('<!--credential-banner-->'), 'html inyectado');
  assert.ok(out.htmlContent.indexOf('<!--credential-banner-->') < out.htmlContent.indexOf('<!--plan-banner-->'), 'credencial antes que plan');
  assert.ok(out.htmlContent.indexOf('<!--plan-banner-->') < out.htmlContent.indexOf('</body>'), 'antes de </body>');
  assert.ok(out.htmlContent.includes(TITLE) && out.htmlContent.includes(CTA_URL_MOV) && out.htmlContent.includes('27/09/2026'));
  assert.ok(out.textContent.includes(TITLE) && out.textContent.includes(`${CTA_LABEL}: ${CTA_URL_MOV}`), 'text inyectado');
  // Idempotente: una segunda pasada no duplica.
  const again = applyBannerFallback(out.htmlContent, out.textContent, banners);
  assert.strictEqual(again.htmlContent.split('<!--credential-banner-->').length, 2, 'html sin duplicar');
  assert.strictEqual(again.textContent.split(TITLE).length, 2, 'text sin duplicar');
});

test('applyBannerFallback: plantilla CON slot {{credentialBannerHtml}} renderizado → no se inyecta dos veces', async () => {
  CONFIG = CONFIG_ABIERTA;
  const banners = await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date() }), { sourceEmail: 'movimiento' });
  const tplHtml = '<html><body><table>{{credentialBannerHtml}}{{planBannerHtml}}</table></body></html>';
  const tplText = 'Cuerpo\n{{credentialBannerText}}{{planBannerText}}';
  const html = processTemplate(tplHtml, banners.templateVars);
  const text = processTemplate(tplText, banners.templateVars);
  assert.ok(html.includes('<!--credential-banner-->'), 'slot renderizado');
  const out = applyBannerFallback(html, text, banners);
  assert.strictEqual(out.htmlContent.split('<!--credential-banner-->').length, 2, 'una sola vez en html');
  assert.strictEqual(out.textContent.split(TITLE).length, 2, 'una sola vez en text');
});

test('applyBannerFallback: correo que NO es de movimientos (tareas) con requiresAction → no se inyecta el banner de credencial por fallback', async () => {
  CONFIG = { bannerPolicy: { sharedCooldown: { enabled: false } }, planBanner: { enabled: false }, featureBanner: { enabled: false }, googleCalendarBanner: { enabled: false }, notificationOptionsBanner: { enabled: false } };
  const banners = await resolveEmailBanners(USER_ID, userFake({ requiresAction: true, since: new Date() }), { sourceEmail: 'tareas' });
  const out = applyBannerFallback('<html><body>x</body></html>', 'x', banners);
  assert.strictEqual(out.htmlContent, '<html><body>x</body></html>');
  assert.strictEqual(out.textContent, 'x');
});

test('applyBannerFallback: sin credencial → no agrega nada de credencial', async () => {
  CONFIG = { bannerPolicy: { sharedCooldown: { enabled: false } }, planBanner: { enabled: false }, featureBanner: { enabled: false }, googleCalendarBanner: { enabled: false }, notificationOptionsBanner: { enabled: false } };
  const banners = await resolveEmailBanners(USER_ID, userFake({ requiresAction: false }), { sourceEmail: 'movimiento' });
  const out = applyBannerFallback('<html><body>x</body></html>', 'x', banners);
  assert.strictEqual(out.htmlContent, '<html><body>x</body></html>');
  assert.strictEqual(out.textContent, 'x');
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      log(`  OK   ${t.name}`, 'green');
    } catch (err) {
      failed++;
      log(`  FAIL ${t.name}\n       ${err.message}`, 'red');
    }
  }
  log(`\n${passed} OK, ${failed} FAIL`, failed ? 'red' : 'cyan');
  process.exit(failed ? 1 : 0);
})();
