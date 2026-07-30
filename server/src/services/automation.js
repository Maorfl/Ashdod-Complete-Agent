/**
 * services/automation.js — מקור אמת יחיד למצב האוטומציה (העברה לחיפה): מצב לכל
 * מחלקה (off/dry_run/on), מתג-כיבוי גלובלי (kill switch), וחסימה קבועה לתיקים ישנים
 * (auto_send_excluded) שמבטיחה שהאוטומציה פועלת אך ורק על תיקים שסומנו כזכאים —
 * לעולם לא על מצבת התיקים הקיימת כשהמנגנון עלה לראשונה, אלא אם שוחררו במפורש.
 *
 * נשמר ב-data/automation.json (לא config/config.json — נקרא/נכתב חי בזמן ריצה,
 * ללא restart, בניגוד ל-config.json שנטען פעם אחת ב-boot דרך config.js).
 *
 * מנגנון אחד בלבד קובע זכאות (2026-07-30, פישוט מכוון): auto_send_excluded=1 על
 * כל תיק שכבר היה ב-DB ברגע ההפעלה הראשונה (migrateAutoSendExclusion, db/shipments.js).
 * תיקים חדשים נוצרים לא-מסומנים (NULL) וזכאים מיידית (בכפוף לשאר תנאי השער). שחרור
 * חד-פעמי וממוקד (למשל release-cus1-ready.js) יכול לנקות את הדגל לקבוצת תיקים ספציפית
 * מבלי להשפיע על כל השאר. epoch עדיין נשמר במצב — לשימוש תצוגה/דיאגנוסטיקה בלבד,
 * *לא* כתנאי שער נוסף (היה קיים ככה בעבר; הוסר בכוונה כדי שלא יהיו שני מנגנונים
 * חופפים שכל שחרור ממוקד צריך "לנצח" את שניהם).
 * אם הבדיקה לא ניתנת להערכה (עמודה חסרה) — הגישה שמרנית: לא זכאי לאוטומציה (hold, לא שליחה).
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');
const shipments = require('../db/shipments');

const AUTOMATION_PATH = path.join(DATA_DIR, 'automation.json');
const DEPTS = ['cus1', 'cus2', 'cus3'];
const MODES = new Set(['off', 'dry_run', 'on']);

// מצב ברירת מחדל בעת הפעלה ראשונה (אין עדיין data/automation.json בדיסק) —
// cus1 פעיל, cus2/cus3 כבויים (הסכמת המשתמש המקורית על ההפעלה ההדרגתית).
const DEFAULT_STATE = {
  killSwitch: false, // true = כל האוטומציה כבויה, ללא קשר למצב לכל מחלקה
  departments: { cus1: 'on', cus2: 'off', cus3: 'off' },
  epoch: null, // מוגדר בהפעלה ראשונה בלבד (see ensureInitialized)
};

function normalizeMode(m) {
  return MODES.has(m) ? m : 'off';
}

function readRaw() {
  if (!fs.existsSync(AUTOMATION_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(AUTOMATION_PATH, 'utf8'));
  } catch {
    return null; // JSON פגום — מתייחסים כאילו לא קיים; ensureInitialized יבנה מחדש בזהירות
  }
}

function writeRaw(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AUTOMATION_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return state;
}

/**
 * ensureInitialized — קריאה ראשונה אי-פעם (אין automation.json): מסמן את כל התיקים
 * הקיימים כ-auto_send_excluded=1 (migrateAutoSendExclusion, אידמפוטנטי) *ואז* קובע
 * epoch=now וכותב את קובץ המצב. סדר הפעולות חשוב: הסימון קורה לפני שנקבע epoch,
 * כך שאין חלון זמן שבו קובץ המצב כבר קיים אך התיקים הישנים עדיין לא סומנו.
 * קריאות חוזרות (הקובץ כבר קיים) — no-op, מחזיר את המצב הקיים כפי שהוא.
 */
function ensureInitialized() {
  const existing = readRaw();
  if (existing) return existing;
  const stampedCount = shipments.migrateAutoSendExclusion();
  const state = { ...DEFAULT_STATE, epoch: new Date().toISOString() };
  writeRaw(state);
  console.log(`[automation] אתחול ראשוני: ${stampedCount} תיקים קיימים סומנו כמחוץ לאוטומציה (auto_send_excluded). epoch=${state.epoch}`);
  return state;
}

/** קורא את המצב הנוכחי מהדיסק בכל קריאה (חי, לא cache) — כדי שטוגל בעמוד יחול בלי restart */
function getState() {
  const raw = ensureInitialized();
  const departments = { ...DEFAULT_STATE.departments };
  for (const d of DEPTS) departments[d] = normalizeMode(raw.departments?.[d]);
  return {
    killSwitch: !!raw.killSwitch,
    departments,
    epoch: raw.epoch || null,
  };
}

function setDepartmentMode(dept, mode) {
  if (!DEPTS.includes(dept)) throw new Error(`מחלקה לא מוכרת: ${dept}`);
  const normalized = normalizeMode(mode);
  const state = getState();
  state.departments[dept] = normalized;
  writeRaw(state);
  return state;
}

function setKillSwitch(on) {
  const state = getState();
  state.killSwitch = !!on;
  writeRaw(state);
  return state;
}

/** מצב האוטומציה של מחלקה, אחרי החלת מתג-הכיבוי הגלובלי (kill switch => off בפועל) */
function effectiveDeptMode(dept) {
  const state = getState();
  if (state.killSwitch) return 'off';
  return state.departments[dept] || 'off';
}

/**
 * isEligible — מנגנון יחיד קובע זכאות ביחס לתיקים ישנים-מול-חדשים: auto_send_excluded
 * (לא בודק מצב מחלקה/route/Graph — זה בגדר autoSendEnabled ב-reportWatcher).
 * rec לא קיים / השדה לא ניתן להעריך (undefined ולא 0/false מפורש) => לא זכאי.
 */
function isEligible(rec) {
  if (!rec) return false;
  if (rec.auto_send_excluded === undefined) return false; // אין עמודה/לא נטען => לא ניתן להעריך => לא זכאי
  return !rec.auto_send_excluded;
}

module.exports = {
  DEPTS,
  getState,
  setDepartmentMode,
  setKillSwitch,
  effectiveDeptMode,
  isEligible,
  ensureInitialized,
  AUTOMATION_PATH,
};
