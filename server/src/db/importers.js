/**
 * db/importers.js — שכבת נתוני יבואנים. כל יבואן = תיקיה תחת data/importers/<שם>
 * ובתוכה importer.json (שם, ח.פ, מיילים, כתובת, הערות, type, מחלקה). קבצי JSON לוקאליים, לא DB.
 * ללקוחות ההעברה לחיפה (whitelist) נוצר גם instructions.txt נגזר — ראו instructionsText.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');
const scope = require('../scope');

const IMP_ROOT = path.join(DATA_DIR, 'importers');

function safeFolder(name) {
  return String(name).trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 80)
    .replace(/[.\s]+$/, '').trim(); // Windows אינו אוהב נקודה/רווח בסוף שם תיקיה
}

function ensureRoot() {
  fs.mkdirSync(IMP_ROOT, { recursive: true });
}

function list() {
  ensureRoot();
  return fs
    .readdirSync(IMP_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readByFolder(d.name))
    .filter(Boolean);
}

function readByFolder(folder) {
  const p = path.join(IMP_ROOT, folder, 'importer.json');
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { _folder: folder, ...data };
}

// איתור יבואן לפי שם מדויק או alias (לשימוש המסווג)
function findByName(name) {
  if (!name) return null;
  const target = String(name).trim().toLowerCase();
  for (const imp of list()) {
    if (imp.name && imp.name.trim().toLowerCase() === target) return imp;
    if (Array.isArray(imp.aliases) && imp.aliases.some((a) => String(a).trim().toLowerCase() === target)) return imp;
  }
  return null;
}

/**
 * instructionsText — טקסט קובץ ההוראות של לקוח העברה לחיפה, בפורמט המאומת מקבצי
 * ה"הוראות - <לקוח>.docx" (פורמט בלבד — לא מועתקות מהם כתובות אמיתיות):
 *   שורת כותרת (שם הלקוח), "מיילים של היבואן:" + emails,
 *   ורק כאשר cont_general מוגדר — "מיילים של המוביל המשך (<שם>):" + cont_general_emails.
 * מוזן אך ורק מהנתונים החיים ב-importer.json. כשהרשימה ריקה נכתב placeholder מפורש
 * ("— טרם הוזן —") — צפוי ותקין כל עוד כלל אי-העתקת המיילים בתוקף.
 */
const NO_EMAILS_PLACEHOLDER = '— טרם הוזן —';
function instructionsText(record) {
  const emails = (arr) => (arr && arr.length ? arr : [NO_EMAILS_PLACEHOLDER]);
  const lines = [record.name, 'מיילים של היבואן:', ...emails(record.emails)];
  if (record.cont_general) {
    lines.push('', `מיילים של המוביל המשך (${record.cont_general}):`, ...emails(record.cont_general_emails));
  }
  return lines.join('\n') + '\n';
}

// כתיבה/רענון של instructions.txt בתיקיית היבואן — רק ללקוחות ההעברה לחיפה (whitelist).
// נקרא אוטומטית מ-create/update כך שהקובץ לעולם לא מתיישן מול importer.json.
function writeInstructions(folder, record) {
  if (!scope.isWhitelisted(record.name)) return null;
  const dest = path.join(IMP_ROOT, folder, 'instructions.txt');
  fs.writeFileSync(dest, instructionsText(record), 'utf8');
  return dest;
}

function create(data) {
  ensureRoot();
  if (!data.name) throw new Error('שם יבואן חובה');
  const folder = safeFolder(data.name);
  const dir = path.join(IMP_ROOT, folder);
  if (fs.existsSync(path.join(dir, 'importer.json'))) throw new Error('יבואן כבר קיים');
  fs.mkdirSync(dir, { recursive: true });
  const record = normalize(data);
  fs.writeFileSync(path.join(dir, 'importer.json'), JSON.stringify(record, null, 2), 'utf8');
  writeInstructions(folder, record); // לקוח העברה לחיפה חדש => instructions.txt מיידי
  return { _folder: folder, ...record };
}

function update(folder, patch) {
  const current = readByFolder(folder);
  if (!current) throw new Error('יבואן לא נמצא');
  delete current._folder;
  const merged = normalize({ ...current, ...patch });
  fs.writeFileSync(path.join(IMP_ROOT, folder, 'importer.json'), JSON.stringify(merged, null, 2), 'utf8');
  writeInstructions(folder, merged); // רענון — הקובץ לא מתיישן מול emails/cont_general
  return { _folder: folder, ...merged };
}

function remove(folder) {
  const dir = path.join(IMP_ROOT, folder);
  if (!fs.existsSync(dir)) throw new Error('יבואן לא נמצא');
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}

// type ∈ haifa_cont | haifa_self | tls | direct | unknown — קובע את מסלול ההמשך
function normalize(d) {
  return {
    name: d.name || '',
    company_id: d.company_id || '',
    emails: Array.isArray(d.emails) ? d.emails : d.emails ? [d.emails] : [],
    address: d.address || '',
    notes: d.notes || '',
    department: d.department || '',
    service_rep: d.service_rep || '',
    type: d.type || 'unknown',
    dangerous_rule: !!d.dangerous_rule,
    cont_general: d.cont_general || '',
    contact_names: d.contact_names || '', // אנשי קשר ללקוח שאוסף בעצמו (haifa_self) — במקום "צוות {מוביל}"
    cont_general_emails: d.cont_general_emails || [],
    cont_dangerous_emails: d.cont_dangerous_emails || [],
    contacts: Array.isArray(d.contacts) ? d.contacts : [], // אנשי קשר של היבואן (שם/טלפון/מייל) — נפרד מ-emails הכלליים
    aliases: d.aliases || [],
    seen_stations: d.seen_stations || [],
    files: d.files || [],
  };
}

/**
 * needsCompletion — נגזר תמיד מהנתונים בפועל (לא flag שיכול להתיישן), לצורך תג
 * התצוגה "נדרש להשלים יבואן" בדשבורד בלבד — מצומצם במכוון (2026-07-31, אישור
 * משתמש) לתנאי אחד: אין ליבואן אף כתובת מייל. חוסר אנשי-קשר/type='unknown'/מוביל
 * המשך לא-מוגדר אינם מספיקים לתג — יבואן עם מייל אחד לפחות תמיד "שלם" מבחינת התג,
 * גם אם חסרים לו פרטים אחרים. שער האוטומציה (reportWatcher.importerReadyForAutoSend)
 * הוא תנאי נפרד לגמרי ואינו קורא לפונקציה הזו — צמצום התג לא אמור לצמצם את השער.
 */
function missingFields(imp) {
  const hasEmails = Array.isArray(imp.emails) && imp.emails.length > 0;
  return hasEmails ? [] : ['emails'];
}
function needsCompletion(imp) {
  return missingFields(imp).length > 0;
}

/**
 * findByNameLoose — התאמה סלחנית יותר (נרמול רווחים/פיסוק/רישיות, כמו scope.normCust)
 * לפני יצירת יבואן חדש: מונעת יצירת תיאום כפול ("KAL- BINYAN LTD" מול "KAL BINYAN LTD").
 * לא מחליפה את findByName (מדויק, לשימוש המסווג) — רק שער נוסף לפני create.
 */
function normLoose(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function findByNameLoose(name) {
  if (!name) return null;
  const target = normLoose(name);
  for (const imp of list()) {
    if (normLoose(imp.name) === target) return imp;
    if (Array.isArray(imp.aliases) && imp.aliases.some((a) => normLoose(a) === target)) return imp;
  }
  return null;
}

/**
 * ensureImporter — אידמפוטנטי: אם קיים יבואן תואם (מדויק או סלחני) — מחזיר אותו
 * ללא שינוי. אחרת יוצר יבואן חדש (type:'unknown', ללא מיילים/אנשי-קשר) במחלקה
 * שנגזרה. בטוח לריצה חוזרת/מקבילה על אותו שם באותו מחזור קומיט (safeFolder+
 * fs.existsSync ב-create כבר חוסמים דריסה; כאן רק נמנעים מזריקת שגיאה מיותרת).
 */
function ensureImporter(name, { department, service_rep } = {}) {
  const exact = findByName(name);
  if (exact) return { importer: exact, created: false };
  const loose = findByNameLoose(name);
  if (loose) return { importer: loose, created: false };
  try {
    const created = create({ name, department: department || '', service_rep: service_rep || '', type: 'unknown' });
    return { importer: created, created: true };
  } catch (e) {
    // תנאי מירוץ: תיק אחר באותו מחזור כבר יצר את אותו יבואן בין הבדיקה ליצירה
    const raced = findByName(name) || findByNameLoose(name);
    if (raced) return { importer: raced, created: false };
    throw e;
  }
}

// מיגרציה חד-פעמית: סוג טיפול צומצם ל-3 אפשרויות (unknown/haifa_cont/haifa_self) —
// יבואנים ישנים עם type=direct/tls (אפשרויות שהוסרו מה-UI) עוברים ל-unknown.
// אידמפוטנטי — לאחר ריצה ראשונה אין עוד יבואנים כאלה.
const LEGACY_TYPES = new Set(['direct', 'tls']);
function migrateLegacyTypes() {
  let moved = 0;
  for (const imp of list()) {
    if (!LEGACY_TYPES.has(imp.type)) continue;
    update(imp._folder, { type: 'unknown' });
    moved += 1;
  }
  return moved;
}

module.exports = {
  list, readByFolder, findByName, findByNameLoose, create, update, remove, safeFolder,
  instructionsText, writeInstructions, migrateLegacyTypes, IMP_ROOT,
  needsCompletion, missingFields, ensureImporter,
};
