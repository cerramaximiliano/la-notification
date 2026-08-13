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
  featureBannerText: ''
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
async function resolveEmailBanners(userId, user, options = {}) {
  const sourceEmail = options.sourceEmail || 'notificacion';
  const frontBase = process.env.FRONT_BASE_URL || DEFAULT_FRONT_BASE_URL;

  const result = {
    templateVars: { ...EMPTY_VARS },
    planBannerShown: false,
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
    if (bannerCfg.enabled !== false) {
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
  try {
    const featureCfg = (notifConfig && notifConfig.featureBanner) || {};
    const suppressed = result.planBannerShown && featureCfg.showWithPlanBanner !== true;
    if (!suppressed) {
      const feature = buildFeatureBanner(featureCfg, frontBase, sourceEmail);
      result.templateVars.featureBannerHtml = feature.html;
      result.templateVars.featureBannerText = feature.text;
    }
  } catch (err) {
    logger.warn(`[EmailBanners] No se pudo armar el feature banner: ${err.message}`);
  }

  // ---- Registro para el cooldown (llamar tras el envío exitoso) ----
  if (planBannerMeta) {
    result.recordIfShown = async () => {
      try {
        const { PlanBannerSend } = require('../models');
        await PlanBannerSend.create({ userId, ...planBannerMeta });
      } catch (err) {
        logger.warn(`[EmailBanners] No se pudo registrar plan-banner-send para ${userId}: ${err.message}`);
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
    vars.featureBannerHtml && !htmlContent.includes('<!--feature-banner-->') ? vars.featureBannerHtml : null
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
  return { htmlContent, textContent };
}

module.exports = { resolveEmailBanners, buildFeatureBanner, applyBannerFallback };
