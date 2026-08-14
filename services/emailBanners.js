/**
 * Banners compartidos para TODOS los emails de notificación al usuario
 * (movimientos, calendario, tareas, vencimientos, caducidad, prescripción).
 *
 * Dos banners, ambos gobernados por el config doc (editable en caliente):
 *   - Plan upgrade (planBanner): usuarios con carpetas archivadas → sugiere
 *     el plan que las cubra. Cooldown COMPARTIDO entre todos los tipos de
 *     email (plan-banner-sends): un usuario ve como máximo un banner de plan
 *     cada cooldownDays, sin importar qué email lo dispare.
 *   - Feature banner (featureBanner): anuncio publicitario/de novedades
 *     definido por el admin (título, texto, CTA). Por default no se muestra
 *     junto al de plan (showWithPlanBanner) para no apilar banners.
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
  optionsBannerHtml: '',
  optionsBannerText: ''
};

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
 * Resuelve los banners para un email de notificación al usuario.
 *
 * @param {ObjectId|string} userId
 * @param {Object} user - doc del usuario (para logs)
 * @param {Object} [options]
 * @param {string} [options.sourceEmail='notificacion'] - identificador del tipo
 *   de email para el tracking del CTA (movimiento, calendar, tasks, ...)
 * @returns {{ templateVars: Object, planBannerShown: boolean, recordIfShown: Function }}
 */
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
        const cooldownDays = Number.isFinite(bannerCfg.cooldownDays) ? bannerCfg.cooldownDays : 7;
        let inCooldown = false;
        if (cooldownDays > 0) {
          const since = new Date(Date.now() - cooldownDays * 24 * 3600 * 1000);
          inCooldown = Boolean(await PlanBannerSend.exists({ userId, sentAt: { $gte: since } }));
        }
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

    if (!suppressedByPlan && !sharedBlockedFeature && allowedForType(featureCfg, sourceEmail)) {
      const feature = buildFeatureBanner(featureCfg, frontBase, sourceEmail);
      result.templateVars.featureBannerHtml = feature.html;
      result.templateVars.featureBannerText = feature.text;
      if (feature.html) {
        result.featureBannerShown = true;
        if (featureParticipates) {
          featureBannerMeta = { bannerKind: 'feature', emailType: sourceEmail };
        }
      }
    }
  } catch (err) {
    logger.warn(`[EmailBanners] No se pudo armar el feature banner: ${err.message}`);
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
  const metaToRecord = planBannerMeta || featureBannerMeta;
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
  if (vars.optionsBannerText && !textContent.includes('Configurar notificaciones:')) {
    textContent = textContent + vars.optionsBannerText;
  }
  return { htmlContent, textContent };
}

module.exports = { resolveEmailBanners, buildFeatureBanner, applyBannerFallback };
