/**
 * import-haifa-transfer-customers.js — Task 3.
 * קורא את data/טבלת לקוחוות העברה לחיפה.xlsx ומעדכן, לכל אחד מ-19 לקוחות ההעברה,
 * את מטא-הדאטה הלא-מייל ברשומת היבואן:
 *   department, type (haifa_cont/haifa_self לפי כותרת הסקשן), dangerous_rule,
 *   cont_general (המוביל הקנוני: סמא/גולד בונד/סדצקי), notes (הערות + תיאור מלא).
 *
 * מיילים אמיתיים: מאושרים החל מ-2026-07-07 (אישור משתמש מפורש שהפך את ההגבלה
 * הקודמת). emails מעמודת "כתובות מייל — לקוח", cont_general_emails מעמודת
 * "כתובות — מוביל המשך", ו-cont_dangerous_emails = מיילי סמא (המוביל בחומ"ס תמיד)
 * מתוך terminals.json — לכן יש להריץ את import-carriers-terminals.js קודם.
 * ההגנה בשליחה נשארת: external_email_override במסווג מנתב כל To חיצוני בפועל.
 *
 * אידמפוטנטי: הרצה חוזרת מייצרת אותה תוצאה. SheetJS בלבד, אפס תלות ב-LLM.
 * שימוש: node scripts/import-haifa-transfer-customers.js [path-to-xlsx]
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const importersDb = require(path.join(ROOT, 'server', 'src', 'db', 'importers'));

const argPath = process.argv[2];
const XLSX_PATH = argPath
  ? path.resolve(argPath)
  : path.join(ROOT, 'data', 'טבלת לקוחוות העברה לחיפה.xlsx');

// עמודות הגיליון (0-based) לפי שורת הכותרת (index 1)
const COL = { name: 0, custEmails: 1, cont: 2, contEmails: 3, coloader: 4, coloaderEmails: 5, dept: 6, dgRule: 7, notes: 8 };

function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

// מוביל המשך קנוני לפי הטקסט התיאורי (התאמה לכלל continuationCarriers שבמסווג)
function canonicalContinuation(label) {
  const s = String(label || '');
  if (/סמא|SME/i.test(s)) return 'סמא';
  if (/גולד\s*בונד/.test(s)) return 'גולד בונד';
  if (/סדצקי/.test(s)) return 'סדצקי';
  return ''; // אוסף בעצמו / מוביל ייעודי שאינו אחד השלושה — נשמר בהערות בלבד
}

// כלל חומר מסוכן: "✅ חל..." => true ; "לא חל..." => false
function parseDangerousRule(v) {
  const s = String(v || '');
  if (/לא\s*חל/.test(s)) return false;
  return /✅/.test(s) || /(^|[^א-ת])חל([^א-ת]|$)/.test(s);
}

// פירוק תא מיילים (מופרדים ב-/ או שורות/פסיקים) לרשימה נקייה — רק טוקנים עם @
function splitEmails(v) {
  return [...new Set(String(v || '')
    .split(/[\/\n\r,;]+/)
    .map((x) => x.trim())
    .filter((x) => x.includes('@')))];
}

// מיילי המוביל בחומ"ס (סמא — dangerous_goods.override_when_hazardous) מ-terminals.json.
// דורש שimport-carriers-terminals.js רץ קודם עם מיילים אמיתיים; מזהיר אם עדיין override.
let _dangerousCarrierEmails = null;
function smeEmails() {
  if (_dangerousCarrierEmails) return _dangerousCarrierEmails;
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'config.json'), 'utf8'));
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'terminals.json'), 'utf8'));
  const carrier = t.dangerous_goods?.override_when_hazardous || 'סמא';
  const emails = (t.continuation_carriers?.[carrier]?.emails || []).filter((e) => e.includes('@'));
  if (emails.length === 1 && emails[0] === cfg.external_email_override) {
    console.warn(`⚠ מיילי ${carrier} ב-terminals.json הם עדיין ה-override — הרץ קודם את import-carriers-terminals.js`);
  }
  _dangerousCarrierEmails = emails;
  return _dangerousCarrierEmails;
}

function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error('לא נמצא קובץ:', XLSX_PATH);
    process.exit(1);
  }
  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  // אינדקס יבואנים לפי שם מנורמל (trim/רווחים/lowercase + הסרת נקודה בסוף), לסובלנות
  const normName = (s) => norm(s).toLowerCase().replace(/\.+$/, '').trim();
  const byNorm = new Map();
  for (const imp of importersDb.list()) {
    byNorm.set(normName(imp.name), imp);
    for (const a of imp.aliases || []) byNorm.set(normName(a), imp);
  }

  let section = null; // 'haifa_cont' | 'haifa_self'
  const result = { updated: [], created: [], rows: 0 };
  const whitelist = []; // שמות ה-19 בסדר הופעתם בגיליון — נכתב ל-config.report_scope.customer_whitelist

  for (const r of rows) {
    const first = norm(r[COL.name]);
    // כותרת סקשן קובעת את סוג הלקוח
    if (/haifa_self/i.test(first)) { section = 'haifa_self'; continue; }
    if (/haifa_cont/i.test(first)) { section = 'haifa_cont'; continue; }

    const dept = norm(r[COL.dept]);
    // שורת נתונים אמיתית מזוהה ע"י מחלקה תקינה (cus1/cus2/cus3) — פוסל שורת כותרת
    // ("מחלקה") ושורות סעיף/ריקות.
    if (!/^cus\d+$/i.test(dept)) continue;
    result.rows += 1;

    const name = first;
    if (!whitelist.includes(name)) whitelist.push(name);
    const contLabel = norm(r[COL.cont]);
    const contGeneral = canonicalContinuation(contLabel);
    const dangerousRule = parseDangerousRule(r[COL.dgRule]);

    // מיילים אמיתיים (מאושר): לקוח + מוביל המשך מהגיליון; חומ"ס => מיילי סמא מה-config
    const custEmails = splitEmails(r[COL.custEmails]);
    const contEmails = contGeneral ? splitEmails(r[COL.contEmails]) : [];
    const dangerousEmails = dangerousRule ? smeEmails() : [];

    // notes דטרמיניסטי (אידמפוטנטי) — משמר את הניואנסים בלי לגעת במיילים
    const notesParts = [];
    if (norm(r[COL.notes])) notesParts.push(norm(r[COL.notes]));
    notesParts.push(`מוביל המשך: ${contLabel || '—'}`);
    if (norm(r[COL.coloader])) notesParts.push(`CO-LOADER/מסוף: ${norm(r[COL.coloader])}`);
    notesParts.push(`כלל חומ"ס: ${norm(r[COL.dgRule]) || '—'}`);
    if (!contGeneral) notesParts.push('(אין מוביל המשך קנוני — לקוח/מוביל ייעודי)');
    const notes = notesParts.join(' | ');

    const patch = {
      department: dept, type: section || 'unknown', dangerous_rule: dangerousRule,
      cont_general: contGeneral, notes,
      emails: custEmails,                 // מיילים אמיתיים — מאושר (2026-07-07)
      cont_general_emails: contEmails,
      cont_dangerous_emails: dangerousEmails,
    };

    const found = byNorm.get(normName(name));
    if (found) {
      importersDb.update(found._folder, patch);
      result.updated.push(name);
    } else {
      importersDb.create({ name, ...patch });
      result.created.push(name);
    }
  }

  // הערה (2026-07-07): כלל ה-customer_whitelist הוסר מ-report_scope באישור משתמש
  // מפורש — ה-scope הוא כל LCL/אשדוד. הסקריפט אינו כותב עוד את הרשימה ל-config.json
  // (כתיבה כזו הייתה מחזירה בשקט את ההגבלה שהוסרה). הרשימה עדיין מודפסת לתיעוד.

  console.log('=== import-haifa-transfer-customers ===');
  console.log('קובץ:', XLSX_PATH);
  console.log('שורות נתונים (מחלקה לא-ריקה):', result.rows);
  console.log('לקוחות העברה לחיפה שזוהו (לא נכתב ל-report_scope):', whitelist.length);
  console.log('עודכנו:', result.updated.length, JSON.stringify(result.updated));
  console.log('נוצרו :', result.created.length, JSON.stringify(result.created));
}

main();
