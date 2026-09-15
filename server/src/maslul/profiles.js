/**
 * maslul/profiles.js — מאגר פרופילי המיפוי (config/maslul/profiles/*.json).
 *
 * JSON ולא YAML — עקבי עם שאר הקונפיג בפרויקט ובלי תלות חדשה.
 * כתיבה אטומית (temp + rename) כדי שקריסה באמצע לא תשאיר פרופיל פגום —
 * הפרופיל הוא מקור האמת למה "מאומת", ואסור שיישבר.
 *
 * המבנה מוכן להוספת זוגות נוספים בעתיד (bootstrap_assistant מחוץ להיקף כרגע).
 */
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('../config');

const PROFILES_DIR = path.join(CONFIG_DIR, 'maslul', 'profiles');
const TEMPLATES_DIR = path.join(CONFIG_DIR, 'maslul', 'templates');
const DEFAULT_TEMPLATE = path.join(TEMPLATES_DIR, 'duplicate_rows_v2.xlsx');

function listProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs.readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8')));
}

function pathFor(pairId) {
  return path.join(PROFILES_DIR, `${pairId}.json`);
}

function getProfile(pairId) {
  const p = pathFor(pairId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** כתיבה אטומית: temp באותה תיקייה (אותו volume) ואז rename. */
function saveProfile(profile) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  const dest = pathFor(profile.pair_id);
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, dest);
  return profile;
}

/**
 * promoteGuesses — קידום ניחושים ל-verified אחרי אישור מפורש במסך הסקירה (§2, החלטה 5).
 * approvals: [{ sku, model }] — model אופציונלי (עריכה ידנית).
 * כתיבה אחת אטומית לכל הקידומים.
 */
function promoteGuesses(pairId, approvals, invoiceNo) {
  const profile = getProfile(pairId);
  if (!profile) throw Object.assign(new Error(`פרופיל לא נמצא: ${pairId}`), { code: 'E01' });
  const now = new Date().toISOString();
  const promoted = [];
  for (const a of approvals || []) {
    const entry = profile.sku_table[a.sku] || {};
    profile.sku_table[a.sku] = {
      ...entry,
      model: a.model != null ? a.model : entry.model,
      status: 'verified',
      approved_at: now,
      approved_from_invoice: invoiceNo || null,
    };
    promoted.push({ sku: a.sku, model: profile.sku_table[a.sku].model });
  }
  if (promoted.length) saveProfile(profile);
  return { profile, promoted };
}

module.exports = {
  listProfiles, getProfile, saveProfile, promoteGuesses,
  pathFor, PROFILES_DIR, TEMPLATES_DIR, DEFAULT_TEMPLATE,
};
