/**
 * Servicio central de políticas de notificación.
 *
 * Punto único de lectura del doc `judicial-notification-configs`
 * (configKey:'global') para que TODOS los caminos de notificación judicial
 * (webhook, coordinadores y cron de entrega) respeten la misma configuración,
 * editable en caliente desde la admin UI sin restart.
 *
 * Resolución de políticas de movimientos (sparse, igual que en los workers):
 *   movementPolicies.sources[<source>] → movementPolicies.defaults → BASE_POLICY
 *
 * Nota de granularidad: los workers resuelven por su clave propia
 * ('pjn-app-update-worker', 'eje-update-worker', ...). Acá en la entrega el
 * movimiento solo trae la jurisdicción ('pjn'|'eje'|'mev'|'scba'), así que las
 * overrides por source de ESTE servicio usan esas 4 claves. Para un toggle
 * global alcanza con movementPolicies.defaults.
 */

const moment = require('moment-timezone');
const logger = require('../config/logger');
const JudicialNotificationConfig = require('../models/Judicial-notification-config');

const CACHE_TTL_MS = 60 * 1000;
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_ACTIVE_DAYS = [1, 2, 3, 4, 5];

// Política base cuando ni defaults ni sources definen el campo.
const BASE_POLICY = {
  enabled: true,
  notifyArchivedFolders: true,
  activeDays: null, // null → usar notificationSchedule.activeDays global
  offDayMode: 'skip',
  filters: null // null → usar filters globales
};

let cache = { config: null, loadedAt: 0 };

/**
 * Devuelve el doc de configuración con cache de 60 s.
 * Si la carga falla y hay una copia previa, devuelve la copia (stale) para
 * no frenar la entrega por un blip de Mongo. Sin copia previa devuelve null:
 * los llamadores deben tratar null como "sin config → comportamiento legacy".
 */
async function getConfigCached() {
  const now = Date.now();
  if (cache.config && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.config;
  }
  try {
    const config = await JudicialNotificationConfig.getConfig();
    cache = { config, loadedAt: now };
    return config;
  } catch (error) {
    logger.warn(`[PolicyService] No se pudo cargar JudicialNotificationConfig: ${error.message}`);
    return cache.config || null;
  }
}

function invalidateCache() {
  cache = { config: null, loadedAt: 0 };
}

/**
 * Kill-switch global: status.enabled !== false y modo distinto de maintenance.
 * Sin config (null) se asume habilitado.
 */
function isGloballyEnabled(config) {
  if (!config || !config.status) return true;
  return config.status.enabled !== false && config.status.mode !== 'maintenance';
}

/**
 * Merge sparse: solo los campos seteados en cada capa pisan la anterior.
 */
function mergePolicy(base, layer) {
  if (!layer || typeof layer !== 'object') return base;
  const merged = { ...base };
  for (const key of Object.keys(BASE_POLICY)) {
    if (layer[key] !== undefined) merged[key] = layer[key];
  }
  return merged;
}

/**
 * Resuelve la política efectiva para un source de movimiento.
 * @param {Object|null} config - doc de configuración (o null)
 * @param {string} source - 'pjn' | 'eje' | 'mev' | 'scba' (jurisdicción)
 */
function resolvePolicy(config, source) {
  const mp = config && config.movementPolicies ? config.movementPolicies : {};
  let policy = mergePolicy(BASE_POLICY, mp.defaults);
  if (source && mp.sources && mp.sources[source]) {
    policy = mergePolicy(policy, mp.sources[source]);
  }
  return policy;
}

/**
 * ¿Hoy (en la timezone de la config) es día activo para esta política?
 * activeDays de la política overridea el global; null/vacío → global.
 */
function isActiveDay(config, policy, date = new Date()) {
  const timezone = (config && config.notificationSchedule && config.notificationSchedule.timezone) || DEFAULT_TIMEZONE;
  const globalDays = (config && config.notificationSchedule && Array.isArray(config.notificationSchedule.activeDays) && config.notificationSchedule.activeDays.length > 0)
    ? config.notificationSchedule.activeDays
    : DEFAULT_ACTIVE_DAYS;
  const days = (policy && Array.isArray(policy.activeDays) && policy.activeDays.length > 0)
    ? policy.activeDays
    : globalDays;
  const today = moment.tz(date, timezone).day();
  return days.includes(today);
}

/**
 * Filtros de contenido: la política puede traer filters propios; si no,
 * aplican los filters globales del doc. Devuelve true si el movimiento
 * debe notificarse.
 * @param {Object} movimiento - { tipo, detalle }
 */
function passesContentFilters(movimiento, config, policy) {
  const filters = (policy && policy.filters) || (config && config.filters) || {};
  const tipo = (movimiento && movimiento.tipo) || '';
  const detalle = (movimiento && movimiento.detalle) || '';

  const included = Array.isArray(filters.includedMovementTypes) ? filters.includedMovementTypes : [];
  if (included.length > 0 && !included.includes(tipo)) {
    return false;
  }

  const excludedTypes = Array.isArray(filters.excludedMovementTypes) ? filters.excludedMovementTypes : [];
  if (excludedTypes.includes(tipo)) {
    return false;
  }

  const excludedKeywords = Array.isArray(filters.excludedKeywords) ? filters.excludedKeywords : [];
  if (excludedKeywords.length > 0) {
    const detalleLower = detalle.toLowerCase();
    if (excludedKeywords.some((kw) => kw && detalleLower.includes(String(kw).toLowerCase()))) {
      return false;
    }
  }

  return true;
}

/**
 * Hora de entrega programada según notificationSchedule (dailyNotificationHour
 * / Minute en la timezone de la config). Si ya pasó hoy, devuelve ahora
 * (se entrega en la próxima corrida del cron).
 * @param {number} fallbackHour - hora a usar si no hay config disponible
 */
function getScheduledNotifyAt(config, fallbackHour = 19) {
  const schedule = (config && config.notificationSchedule) || {};
  const timezone = schedule.timezone || DEFAULT_TIMEZONE;
  const hour = Number.isInteger(schedule.dailyNotificationHour) ? schedule.dailyNotificationHour : fallbackHour;
  const minute = Number.isInteger(schedule.dailyNotificationMinute) ? schedule.dailyNotificationMinute : 0;

  const notifyAt = moment.tz(timezone).hour(hour).minute(minute).second(0).millisecond(0).toDate();
  const now = new Date();
  return notifyAt < now ? now : notifyAt;
}

/**
 * Horas de reporte admin (formato 'H:mm'). Prioridad:
 * config.notificationSchedule.reportHours → env JUDICIAL_MOVEMENT_REPORT_HOURS → default.
 */
function getReportHours(config) {
  const fromConfig = config && config.notificationSchedule && config.notificationSchedule.reportHours;
  if (Array.isArray(fromConfig) && fromConfig.length > 0) {
    return fromConfig.map((h) => String(h).trim()).filter(Boolean);
  }
  return (process.env.JUDICIAL_MOVEMENT_REPORT_HOURS || '15:00,17:00,19:30').split(',').map((h) => h.trim());
}

module.exports = {
  getConfigCached,
  invalidateCache,
  isGloballyEnabled,
  resolvePolicy,
  isActiveDay,
  passesContentFilters,
  getScheduledNotifyAt,
  getReportHours,
  BASE_POLICY
};
