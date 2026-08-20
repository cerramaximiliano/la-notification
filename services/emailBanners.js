/**
 * Banners compartidos para TODOS los emails de notificación al usuario
 * (movimientos, calendario, tareas, vencimientos, caducidad, prescripción).
 *
 * Banners gobernados por el config doc (editable en caliente):
 *   - Plan upgrade (planBanner): usuarios con carpetas archivadas → sugiere
 *     el plan que las cubra. Cooldown COMPARTIDO entre todos los tipos de
 *     email (plan-banner-sends): un usuario ve como máximo un banner de plan
 *     cada cooldownDays, sin importar qué email lo dispare.
 *   - Feature banner (featureBanner): anuncio publicitario/de novedades
 *     definido por el admin (título, texto, CTA). Por default no se muestra
 *     junto al de plan (showWithPlanBanner) para no apilar banners.
 *   - Google Calendar (googleCalendarBanner): invitación a sincronizar para
 *     usuarios con googleCalendarConnected !== true. Cooldown propio (default
 *     14 días) y un solo banner promocional por email.
 *
 * Uso en cada sender:
 *   const banners = await resolveEmailBanners(userId, user, { sourceEmail: 'calendar' });
 *   templateVariables = { ...vars, ...banners.templateVars };
 *   await sendEmail(...);
 *   await banners.recordIfShown(); // habilita el cooldown (best-effort)
 */

const logger = require('../config/logger');
const policyService = require('./notificationPolicyService');

const DEFAULT_FRONT_BASE_URL = 'https://www.lawanalytics.app';

const EMPTY_VARS = {
  planBannerHtml: '',
  planBannerText: '',
  featureBannerHtml: '',
  featureBannerText: '',
  gcalBannerHtml: '',
  gcalBannerText: '',
  optionsBannerHtml: '',
  optionsBannerText: ''
};

// Logo oficial de Google Calendar (asset hosteado por Google, estable desde 2020)
const GCAL_LOGO_URL = 'https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png';

/**
 * Banner de anuncio/feature (config featureBanner). Marker <!--feature-banner-->.
 */
function buildFeatureBanner(cfg, frontBaseUrl, sourceEmail) {
  if (!cfg || cfg.enabled !== true || !cfg.title) {
    return { html: '', text: '' };
  }
  const ctaUrl = cfg.ctaUrl
    ? `${cfg.ctaUrl}${cfg.ctaUrl.includes('?') ? '&' : '?'}source=email_${sourceEmail}_feature`
    : `${frontBaseUrl || DEFAULT_FRONT_BASE_URL}?source=email_${sourceEmail}_feature`;
  const ctaLabel = cfg.ctaLabel || 'Conocer más';

  const html = `
      <!--feature-banner--><tr><td class="px-card" style="padding:8px 44px 16px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EFF4FF;border:1px solid #C7D8FF;border-radius:10px;">
          <tr><td style="padding:18px 24px;">
            <p style="margin:0 0 4px 0;font-size:11px;color:#3A7BFF;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">Novedad</p>
            <p style="margin:0 0 6px 0;font-size:15px;line-height:1.4;color:#0F172A;font-weight:700;">${cfg.title}</p>
            ${cfg.text ? `<p style="margin:0 0 14px 0;font-size:13px;line-height:1.6;color:#475569;">${cfg.text}</p>` : ''}
            <a href="${ctaUrl}" style="font-size:13px;font-weight:600;color:#3A7BFF;text-decoration:none;">${ctaLabel}&nbsp;&#8594;</a>
          </td></tr>
        </table>
      </td></tr>`;

  const text = `\n---\n${cfg.title}\n${cfg.text ? `${cfg.text}\n` : ''}${ctaLabel}: ${ctaUrl}\n`;

  return { html, text };
}

/**
 * Banner de invitación a sincronizar Google Calendar (config
 * googleCalendarBanner). Marker <!--gcal-banner-->. Mismo lenguaje visual que
 * el feature banner (card #EFF4FF), con el logo de Calendar a la izquierda.
 * Solo se resuelve para usuarios con googleCalendarConnected !== true.
 */
function buildGoogleCalendarBanner(cfg, frontBaseUrl, sourceEmail) {
  const base = frontBaseUrl || DEFAULT_FRONT_BASE_URL;
  const rawUrl = cfg.ctaUrl || `${base}/apps/calendar`;
  const ctaUrl = `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}source=email_${sourceEmail}_gcal`;
  const title = cfg.title || 'Conectá tu Google Calendar';
  const text = cfg.text
    || 'Traé tus audiencias y vencimientos de Google a Law||Analytics y recibí todos tus recordatorios en un solo lugar. Con la sincronización automática, tus eventos se mantienen al día solos.';
  const ctaLabel = cfg.ctaLabel || 'Conectar mi calendario';

  const html = `
      <!--gcal-banner--><tr><td class="px-card" style="padding:8px 44px 16px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EFF4FF;border:1px solid #C7D8FF;border-radius:10px;">
          <tr><td style="padding:18px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="top" style="width:56px;padding-right:16px;">
                <img src="${GCAL_LOGO_URL}" width="40" height="40" alt="Google Calendar" style="display:block;border:0;" />
              </td>
              <td valign="top">
                <p style="margin:0 0 4px 0;font-size:11px;color:#3A7BFF;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">Google Calendar</p>
                <p style="margin:0 0 6px 0;font-size:15px;line-height:1.4;color:#0F172A;font-weight:700;">${title}</p>
                <p style="margin:0 0 14px 0;font-size:13px;line-height:1.6;color:#475569;">${text}</p>
                <a href="${ctaUrl}" style="font-size:13px;font-weight:600;color:#3A7BFF;text-decoration:none;">${ctaLabel}&nbsp;&#8594;</a>
              </td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>`;

  const textVersion = `\n---\n${title}\n${text}\n${ctaLabel}: ${ctaUrl}\n`;

  return { html, text: textVersion };
}

/**
 * Resuelve los banners para un email de notificación al usuario.
 *
 * @param {ObjectId|string} userId
 * @param {Object} user - doc del usuario (para logs)
 * @param {Object} [options]
 * @param {string} [options.sourceEmail='notificacion'] - identificador del tipo
 *   de email para el tracking del CTA (movimiento, calendar, tasks, ...)
 * @returns {{ templateVars: Object, planBannerShown: boolean, recordIfShown: Function }}
 */
/**
 * Ventana de cooldown propia de un banner para el correo que se está por
 * enviar. Config por banner:
 *   cooldownDays: ventana default en días (0 = sin cooldown propio)
 *   cooldownByEmailType: { tipo: días } — override de la ventana según el TIPO
 *     de correo que se está por enviar (ej: { calendario: 7, movimiento: 30 })
 */
function resolveBannerCooldownDays(cfg, sourceEmail, defaultDays) {
  const byType = cfg && cfg.cooldownByEmailType && typeof cfg.cooldownByEmailType === 'object'
    ? cfg.cooldownByEmailType
    : null;
  if (byType && Number.isFinite(Number(byType[sourceEmail]))) return Number(byType[sourceEmail]);
  return Number.isFinite(cfg && cfg.cooldownDays) ? cfg.cooldownDays : defaultDays;
}

/**
 * ¿Este banner está dentro de su cooldown propio?
 *
 * cooldownScope decide qué cuenta como repetición:
 *   'banner' (default) — lo recibió en CUALQUIER tipo de correo dentro de la
 *     ventana → no repetir en ninguno.
 *   'banner-email' — solo cuenta si lo recibió en ESTE mismo tipo de correo:
 *     puede recibirlo en movimientos y también en calendario, pero no dos
 *     veces en calendario dentro de la ventana.
 */
async function bannerInCooldown(PlanBannerSend, userId, bannerKind, sourceEmail, cfg, defaultDays) {
  const days = resolveBannerCooldownDays(cfg, sourceEmail, defaultDays);
  if (!(days > 0)) return false;
  const query = {
    userId,
    bannerKind,
    sentAt: { $gte: new Date(Date.now() - days * 24 * 3600 * 1000) }
  };
  if (cfg && cfg.cooldownScope === 'banner-email') query.emailType = sourceEmail;
  return Boolean(await PlanBannerSend.exists(query));
}

/** ¿Este banner puede aparecer en este tipo de email? (config emailTypes) */
function allowedForType(cfg, sourceEmail) {
  const types = cfg && Array.isArray(cfg.emailTypes) ? cfg.emailTypes : null;
  if (!types || types.length === 0) return true; // sin restricción configurada
  return types.includes(sourceEmail);
}

async function resolveEmailBanners(userId, user, options = {}) {
  const sourceEmail = options.sourceEmail || 'notificacion';
  const frontBase = process.env.FRONT_BASE_URL || DEFAULT_FRONT_BASE_URL;

  const result = {
    templateVars: { ...EMPTY_VARS },
    planBannerShown: false,
    featureBannerShown: false,
    recordIfShown: async () => {}
  };

  let notifConfig = null;
  try {
    notifConfig = await policyService.getConfigCached();
  } catch (err) {
    logger.warn(`[EmailBanners] No se pudo cargar config: ${err.message}`);
    return result;
  }

  // ---- Banner de plan (carpetas archivadas) ----
  let planBannerMeta = null;
  try {
    const { Folder, PlanBannerSend } = require('../models');
    const bannerCfg = (notifConfig && notifConfig.planBanner) || {};
    const policyCfg = (notifConfig && notifConfig.bannerPolicy) || {};
    const sharedCooldown = policyCfg.sharedCooldown || {};
    const sharedParticipants = Array.isArray(sharedCooldown.participants) ? sharedCooldown.participants : ['plan', 'feature'];
    const sharedEnabled = sharedCooldown.enabled !== false && sharedParticipants.length > 0;
    // Cooldown compartido: si YA se mostró cualquier banner participante en la
    // ventana, ninguno de los participantes vuelve a mostrarse.
    let sharedBlocked = false;
    if (sharedEnabled) {
      const days = Number.isFinite(sharedCooldown.days) ? sharedCooldown.days : 7;
      if (days > 0) {
        const since = new Date(Date.now() - days * 24 * 3600 * 1000);
        sharedBlocked = Boolean(await PlanBannerSend.exists({
          userId,
          sentAt: { $gte: since },
          bannerKind: { $in: sharedParticipants }
        }));
      }
    }
    const planParticipates = sharedEnabled && sharedParticipants.includes('plan');
    if (bannerCfg.enabled !== false && allowedForType(bannerCfg, sourceEmail) && !(planParticipates && sharedBlocked)) {
      const archivedCount = await Folder.countDocuments({ userId, archived: true });
      const minArchived = Number.isFinite(bannerCfg.minArchivedFolders) ? bannerCfg.minArchivedFolders : 1;
      if (archivedCount >= minArchived) {
        // Antes esta query no filtraba por bannerKind: cualquier banner (incluso
        // gcal) frenaba al de plan. Ahora el cooldown propio es del banner, con
        // alcance y ventana configurables.
        const inCooldown = await bannerInCooldown(PlanBannerSend, userId, 'plan', sourceEmail, bannerCfg, 7);
        if (!inCooldown) {
          const activeCount = await Folder.countDocuments({ userId, archived: { $ne: true } });
          const { suggestPlanUpgrade } = require('./planSuggestion');
          const suggestion = await suggestPlanUpgrade(userId, { archivedCount, activeCount });
          const excluded = suggestion && Array.isArray(bannerCfg.excludePlans)
            && bannerCfg.excludePlans.includes(suggestion.current.planId);
          if (suggestion && !excluded) {
            const promo = bannerCfg.promo && bannerCfg.promo.enabled === true && bannerCfg.promo.code
              ? { code: bannerCfg.promo.code, text: bannerCfg.promo.text }
              : null;
            const { buildPlanUpgradeBanner } = require('./templateProcessor');
            const banner = buildPlanUpgradeBanner(suggestion, frontBase, promo);
            result.templateVars.planBannerHtml = banner.html;
            result.templateVars.planBannerText = banner.text;
            result.planBannerShown = true;
            planBannerMeta = {
              bannerKind: 'plan',
              emailType: sourceEmail,
              suggestedPlanId: suggestion.suggested.planId,
              archivedCount,
              promoCode: promo ? promo.code : null
            };
            logger.info(`Banner de upgrade para ${user?.email || userId} (${sourceEmail}): ${archivedCount} archivadas, sugerido ${suggestion.suggested.planId}${promo ? ` (promo ${promo.code})` : ''}`);
          }
        }
      }
    }
  } catch (err) {
    logger.warn(`[EmailBanners] No se pudo armar el banner de plan para ${user?.email || userId}: ${err.message}`);
  }

  // ---- Feature banner (anuncio del admin) ----
  let featureBannerMeta = null;
  try {
    const featureCfg = (notifConfig && notifConfig.featureBanner) || {};
    const policyCfg2 = (notifConfig && notifConfig.bannerPolicy) || {};
    const shared2 = policyCfg2.sharedCooldown || {};
    const participants2 = Array.isArray(shared2.participants) ? shared2.participants : ['plan', 'feature'];
    const featureParticipates = shared2.enabled !== false && participants2.includes('feature');

    // Bloqueos: (a) ya va el de plan en este email (salvo showWithPlanBanner),
    // (b) tipo de email no habilitado, (c) cooldown compartido consumido.
    const suppressedByPlan = result.planBannerShown && featureCfg.showWithPlanBanner !== true;
    let sharedBlockedFeature = false;
    if (featureParticipates && !result.planBannerShown) {
      const days2 = Number.isFinite(shared2.days) ? shared2.days : 7;
      if (days2 > 0) {
        const { PlanBannerSend } = require('../models');
        const since2 = new Date(Date.now() - days2 * 24 * 3600 * 1000);
        sharedBlockedFeature = Boolean(await PlanBannerSend.exists({
          userId,
          sentAt: { $gte: since2 },
          bannerKind: { $in: participants2 }
        }));
      }
    } else if (featureParticipates && result.planBannerShown) {
      // El de plan ya ocupa la ventana compartida de este envío.
      sharedBlockedFeature = true;
    }

    // Cooldown propio opcional (default 0 = solo rige el compartido).
    const featureOwnDays = resolveBannerCooldownDays(featureCfg, sourceEmail, 0);
    let featureOwnBlocked = false;
    if (featureOwnDays > 0 && !suppressedByPlan && !sharedBlockedFeature) {
      const { PlanBannerSend } = require('../models');
      featureOwnBlocked = await bannerInCooldown(PlanBannerSend, userId, 'feature', sourceEmail, featureCfg, 0);
    }

    if (!suppressedByPlan && !sharedBlockedFeature && !featureOwnBlocked && allowedForType(featureCfg, sourceEmail)) {
      const feature = buildFeatureBanner(featureCfg, frontBase, sourceEmail);
      result.templateVars.featureBannerHtml = feature.html;
      result.templateVars.featureBannerText = feature.text;
      if (feature.html) {
        result.featureBannerShown = true;
        // Se registra si participa del compartido O si tiene cooldown propio
        // (este último depende del registro para funcionar).
        if (featureParticipates || featureOwnDays > 0) {
          featureBannerMeta = { bannerKind: 'feature', emailType: sourceEmail };
        }
      }
    }
  } catch (err) {
    logger.warn(`[EmailBanners] No se pudo armar el feature banner: ${err.message}`);
  }

  // ---- Banner de Google Calendar (usuarios sin sincronizar) ----
  let gcalBannerMeta = null;
  try {
    const gcalCfg = (notifConfig && notifConfig.googleCalendarBanner) || {};
    const policyCfg3 = (notifConfig && notifConfig.bannerPolicy) || {};
    const shared3 = policyCfg3.sharedCooldown || {};
    const participants3 = Array.isArray(shared3.participants) ? shared3.participants : ['plan', 'feature'];
    const gcalParticipates = shared3.enabled !== false && participants3.includes('gcal');

    // Segmentación: solo usuarios que nunca vincularon Google Calendar. Sin el
    // doc del usuario no se puede saber → no se muestra (mejor omitir que
    // invitarle a conectar a alguien que ya conectó).
    const isTarget = user && user.googleCalendarConnected !== true;

    // Un solo banner promocional por email: si ya va el de plan o el de
    // feature, este se calla (salvo override explícito del admin).
    const suppressedByOthers = (result.planBannerShown || result.featureBannerShown)
      && gcalCfg.showWithOtherBanners !== true;

    if (gcalCfg.enabled !== false && isTarget && !suppressedByOthers && allowedForType(gcalCfg, sourceEmail)) {
      const { PlanBannerSend } = require('../models');
      // Cooldown propio (default 14 días): es una invitación, no un recordatorio.
      // Alcance y ventana por tipo de correo configurables (cooldownScope /
      // cooldownByEmailType).
      let blocked = await bannerInCooldown(PlanBannerSend, userId, 'gcal', sourceEmail, gcalCfg, 14);
      // Si participa del cooldown compartido, cualquier banner de la ventana lo bloquea.
      if (!blocked && gcalParticipates) {
        const daysShared = Number.isFinite(shared3.days) ? shared3.days : 7;
        if (daysShared > 0) {
          const sinceShared = new Date(Date.now() - daysShared * 24 * 3600 * 1000);
          blocked = Boolean(await PlanBannerSend.exists({
            userId,
            sentAt: { $gte: sinceShared },
            bannerKind: { $in: participants3 }
          }));
        }
      }
      if (!blocked) {
        const gcal = buildGoogleCalendarBanner(gcalCfg, frontBase, sourceEmail);
        result.templateVars.gcalBannerHtml = gcal.html;
        result.templateVars.gcalBannerText = gcal.text;
        result.gcalBannerShown = true;
        // Siempre se registra: el cooldown propio depende de este registro.
        gcalBannerMeta = { bannerKind: 'gcal', emailType: sourceEmail };
        logger.info(`Banner de Google Calendar para ${user?.email || userId} (${sourceEmail})`);
      }
    }
  } catch (err) {
    logger.warn(`[EmailBanners] No se pudo armar el banner de Google Calendar: ${err.message}`);
  }

  // Strip informativo de opciones de notificación (no participa del cooldown
  // por default: es ayuda de configuración, no promoción).
  try {
    const optionsCfg = (notifConfig && notifConfig.notificationOptionsBanner) || {};
    const participantsOpt = Array.isArray(((notifConfig || {}).bannerPolicy || {}).sharedCooldown?.participants)
      ? notifConfig.bannerPolicy.sharedCooldown.participants
      : ['plan', 'feature'];
    if (optionsCfg.enabled !== false && allowedForType(optionsCfg, sourceEmail) && !participantsOpt.includes('options')) {
      const { buildNotificationOptionsBanner } = require('./templateProcessor');
      const opts = buildNotificationOptionsBanner(optionsCfg, frontBase, sourceEmail);
      result.templateVars.optionsBannerHtml = opts.html;
      result.templateVars.optionsBannerText = opts.text;
    }
  } catch (err) {
    logger.warn(`[EmailBanners] No se pudo armar el strip de opciones: ${err.message}`);
  }

  // ---- Registro para el cooldown (llamar tras el envío exitoso) ----
  const metaToRecord = planBannerMeta || featureBannerMeta || gcalBannerMeta;
  if (metaToRecord) {
    result.recordIfShown = async () => {
      try {
        const { PlanBannerSend } = require('../models');
        await PlanBannerSend.create({ userId, ...metaToRecord });
      } catch (err) {
        logger.warn(`[EmailBanners] No se pudo registrar banner-send para ${userId}: ${err.message}`);
      }
    };
  }

  return result;
}

/**
 * Fallback de slots: si el template no renderizó los banners (slot ausente
 * o todavía sin patchear), los inyecta antes del cierre del body. Devuelve
 * {htmlContent, textContent} ya ajustados.
 */
function applyBannerFallback(htmlContent, textContent, banners) {
  const vars = banners.templateVars || EMPTY_VARS;
  const missing = [
    vars.planBannerHtml && !htmlContent.includes('<!--plan-banner-->') ? vars.planBannerHtml : null,
    vars.featureBannerHtml && !htmlContent.includes('<!--feature-banner-->') ? vars.featureBannerHtml : null,
    vars.gcalBannerHtml && !htmlContent.includes('<!--gcal-banner-->') ? vars.gcalBannerHtml : null,
    vars.optionsBannerHtml && !htmlContent.includes('<!--options-banner-->') ? vars.optionsBannerHtml : null
  ].filter(Boolean);

  if (missing.length > 0) {
    const bannerBlock = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">${missing.join('')}</table>`;
    htmlContent = /<\/body>/i.test(htmlContent)
      ? htmlContent.replace(/<\/body>/i, `${bannerBlock}</body>`)
      : htmlContent + bannerBlock;
  }
  if (vars.planBannerText && !textContent.includes('Mejorar mi plan:')) {
    textContent = textContent + vars.planBannerText;
  }
  const featureTitleLine = vars.featureBannerText ? (vars.featureBannerText.trim().split('\n')[1] || null) : null;
  if (vars.featureBannerText && featureTitleLine && !textContent.includes(featureTitleLine)) {
    textContent = textContent + vars.featureBannerText;
  }
  const gcalTitleLine = vars.gcalBannerText ? (vars.gcalBannerText.trim().split('\n')[1] || null) : null;
  if (vars.gcalBannerText && gcalTitleLine && !textContent.includes(gcalTitleLine)) {
    textContent = textContent + vars.gcalBannerText;
  }
  if (vars.optionsBannerText && !textContent.includes('Configurar notificaciones:')) {
    textContent = textContent + vars.optionsBannerText;
  }
  return { htmlContent, textContent };
}

module.exports = {
  resolveEmailBanners,
  buildFeatureBanner,
  buildGoogleCalendarBanner,
  applyBannerFallback,
  // exportados para pruebas
  resolveBannerCooldownDays,
  bannerInCooldown
};
