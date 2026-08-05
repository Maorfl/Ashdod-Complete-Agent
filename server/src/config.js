/**
 * config.js — טוען את כל קבצי ההגדרות מ-config/ ומרכז גישה אליהם.
 * אפס תלות ב-LLM. כל ערכי ברירת המחדל והדומיין מגיעים מ-config/*.json.
 *
 * config.json/terminals.json נטענים עם cache לפי mtime (Task 1): כל קריאה בודקת אם
 * הקובץ השתנה בדיסק ומפרסרת מחדש רק במקרה הזה. config/coLoaders/terminals נשארים
 * אותם bindings קבועים (module.exports.config וכו') — לעולם לא מוחלפים; במקום זאת
 * מעודכנים in-place (נוקים מפתחות ישנים + Object.assign מפתחות טריים), כדי שכל
 * `const { config } = require('../config')` קיים בקוד ימשיך להצביע לאותו אובייקט
 * ויראה ערכים עדכניים בלי restart. refreshConfig()/refreshTerminals() נקראות ע"י
 * reportWatcher.commit() בתחילת כל מחזור קומיט (לא בלולאת הרשומות עצמה).
 */
const fs = require('fs');
const path = require('path');

// טעינת server/.env אל process.env (סודות/override סביבתי) — לפני קריאת המשתנים.
// Node 22: process.loadEnvFile; נפילה חיננית לפרסר ידני אם אינו זמין.
(function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
      return;
    }
  } catch { /* נפילה לפרסר הידני */ }
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
})();

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_DIR = path.join(ROOT, 'config');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
}

// מיגרציה בזיכרון (legacy — לא בשימוש עוד ע"י שער האוטומציה): auto_send_haifa_transfer
// עובר מ-boolean למחרוזת תלת-מצבית off/dry_run/on. true (ישן) -> on, false/חסר -> off.
// לא כותב בחזרה לקובץ. הוחלף במצב per-department ב-data/automation.json
// (services/automation.js) — הדגל הגלובלי הזה נשאר כאן רק לתאימות/מסמכים היסטוריים.
// מופעל בכל פעם שהקובץ נטען מחדש (לא רק ב-boot) — ראו loadConfigFresh.
function migrateAutoSendMode(cfg) {
  const ff = cfg.feature_flags || (cfg.feature_flags = {});
  const raw = ff.auto_send_haifa_transfer;
  if (raw === true) ff.auto_send_haifa_transfer = 'on';
  else if (raw === false || raw === undefined || raw === null) ff.auto_send_haifa_transfer = 'off';
  // כבר מחרוזת (off/dry_run/on) — נשאר כפי שהוא
}

// עדכון in-place של אובייקט/Set קיים מתוך תוכן טרי — שומר על ה-binding המקורי חי
// אצל כל צרכן שכבר עשה `const { x } = require('../config')` (ראו הערת הכותרת).
function assignInPlace(target, fresh) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, fresh);
  return target;
}

// --- config.json: cache לפי mtime ---
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const config = {}; // binding קבוע — לעולם לא מוחלף, רק מתעדכן in-place
let _configMtimeMs = null;

function loadConfigFresh() {
  const stat = fs.statSync(CONFIG_PATH);
  if (_configMtimeMs !== null && stat.mtimeMs === _configMtimeMs) return false; // ללא שינוי
  const fresh = loadJson('config.json');
  migrateAutoSendMode(fresh);
  assignInPlace(config, fresh);
  _configMtimeMs = stat.mtimeMs;
  return true;
}
loadConfigFresh();

// --- terminals.json: cache לפי mtime (continuation_carriers + dangerous_goods + haifa_arrival_senders) ---
// co_loaders.json ו-terminals.json (בלוק terminals) כבר חיים בפועל דרך db/contacts.js
// (parse עצמאי משלו + writeCoLoaders/writeTerminals) — אין כאן כפילות מיותרת מעבר
// לשני הבלוקים האלה, שאינם נגישים דרך contacts.js.
const TERMINALS_PATH = path.join(CONFIG_DIR, 'terminals.json');
const continuationCarriers = {};
const dangerousGoods = {};
const haifaSenders = {}; // אובייקט (מפתח -> כלל שולח), לא מערך — ראו mailTracker.js
let _terminalsMtimeMs = null;

function loadTerminalsFresh() {
  const stat = fs.statSync(TERMINALS_PATH);
  if (_terminalsMtimeMs !== null && stat.mtimeMs === _terminalsMtimeMs) return false; // ללא שינוי
  const fresh = loadJson('terminals.json');
  assignInPlace(continuationCarriers, fresh.continuation_carriers || {});
  assignInPlace(dangerousGoods, fresh.dangerous_goods || {});
  assignInPlace(haifaSenders, fresh.haifa_arrival_senders || {});
  _terminalsMtimeMs = stat.mtimeMs;
  return true;
}
loadTerminalsFresh();

/**
 * refreshIfChanged — בודקת mtime של config.json + terminals.json ומפרסרת מחדש רק אם
 * השתנו. נקראת ע"י reportWatcher.commit() בתחילת כל מחזור קומיט (לא בלולאת הרשומות),
 * כך שעריכה ידנית לקובץ בזמן שהשרת רץ נקלטת במחזור הקומיט הבא בלי restart.
 */
function refreshIfChanged() {
  const configChanged = loadConfigFresh();
  const terminalsChanged = loadTerminalsFresh();
  return configChanged || terminalsChanged;
}

// override סביבתי קל (PORT/HOST/REPORT_PATH) מעל config.json — restart-only (זהות תהליך).
const PORT = Number(process.env.PORT || config.server?.port || 4000);
const HOST = process.env.HOST || config.server?.host || '0.0.0.0';
// report_path היחסי נפתר מול שורש הפרויקט (לא מול cwd של התהליך)
const rawReportPath = process.env.REPORT_PATH || config.report_path;
const REPORT_PATH = path.isAbsolute(rawReportPath) ? rawReportPath : path.resolve(ROOT, rawReportPath);

module.exports = {
  ROOT,
  CONFIG_DIR,
  DATA_DIR: path.join(ROOT, 'data'),
  config,
  PORT,
  HOST,
  REPORT_PATH,
  continuationCarriers,
  dangerousGoods,
  haifaSenders,
  refreshIfChanged,
};
