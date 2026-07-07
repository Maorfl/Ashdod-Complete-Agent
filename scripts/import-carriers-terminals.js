/**
 * import-carriers-terminals.js — Task 5.
 * קורא את data/משלחים_מסופים_מובילים_1.xlsx (3 גיליונות) וממזג לתוך:
 *   config/co_loaders.json   (גיליון CO-LOADERS)
 *   config/terminals.json    (גיליונות מסופים + מובילי המשך)
 *
 * עקרונות:
 *  - מיילים אמיתיים: מאושרים החל מ-2026-07-07 (אישור משתמש מפורש). נכתבים מהגיליונות;
 *    תא placeholder (⏳ / — / "יש להשלים", ללא @) => נשאר override + needs_review.
 *    ההגנה בשליחה נשארת: external_email_override במסווג מנתב כל To חיצוני בפועל.
 *  - מין דקדוקי -> gender(m/f)/number(s/p) במיפוי ממצה. ערך לא-מוכר שאינו placeholder
 *    (⏳/—) => זריקת שגיאה רועשת (לא ברירת-מחדל שקטה).
 *  - מסופים: המפתחות הקיימים ב-terminals.json תואמים את הדוח האמיתי (שמות קצרים כמו
 *    "אוברסיז אשדוד") — לכן לא מוחקים/משנים ניתוב קיים. רק מעשירים מטא-דאטה, ומוסיפים
 *    את שמות ה-Focus הארוכים מהגיליון כמפתחות נוספים הממורים לאותו ניתוב, כדי שגם דוח
 *    שמשתמש בצורה הארוכה יתאים (normKey שבמסווג מכווץ את ה-\r\n ממילא).
 *  - אידמפוטנטי. SheetJS בלבד, אפס תלות ב-LLM.
 *
 * שימוש: node scripts/import-carriers-terminals.js [path-to-xlsx]
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const config = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'config.json'), 'utf8'));
const OVERRIDE = config.external_email_override || 'maorfl14@gmail.com';

const argPath = process.argv[2];
const XLSX_PATH = argPath ? path.resolve(argPath) : path.join(ROOT, 'data', 'משלחים_מסופים_מובילים_1.xlsx');

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const isPlaceholder = (s) => !norm(s) || /⏳|^—$|יש להשלים|לאשר/.test(String(s));

// מין דקדוקי -> gender/number (ממצה; זורק על ערך לא-מוכר שאינו placeholder)
function parseGrammar(v) {
  const s = norm(v);
  if (isPlaceholder(s)) return null; // placeholder — לא קובעים מגדר, נשמור needs_review
  const map = {
    'נקבה רבות': { gender: 'f', number: 'p' },
    'נקבה יחיד': { gender: 'f', number: 's' },
    'זכר רבים': { gender: 'm', number: 'p' },
    'זכר יחיד': { gender: 'm', number: 's' },
  };
  if (map[s]) return map[s];
  throw new Error(`מין דקדוקי לא מוכר: "${s}" — יש להוסיף מיפוי מפורש (לא מגדירים ברירת מחדל שקטה).`);
}

function splitEmails(v) {
  // רק טוקנים עם @ — מסנן אוטומטית placeholders (⏳/—/"יש להשלים") וטקסט חופשי
  return [...new Set(String(v || '').split(/[\/\n\r,;]+/).map((x) => x.trim()).filter((x) => x.includes('@')))];
}

function readSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`חסר גיליון: ${name}`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
}

// ---------- CO-LOADERS ----------
function importCoLoaders(wb, out) {
  const rows = readSheet(wb, 'CO-LOADERS');
  const file = path.join(CONFIG_DIR, 'co_loaders.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cl = doc.co_loaders;
  // C: קוד(0) שם(1) שם אנגלי(2) מיילים(3) איש קשר(4) מין דקדוקי(5) ניסוח(6) הערות(7)
  for (const r of rows) {
    const code = norm(r[0]);
    if (!/^\d+$/.test(code)) continue;              // דלג כותרות/אזהרות
    if (code === '267') { out.coloaders.skipped.push('267 (קוד הבית — כספי)'); continue; }

    const grammar = parseGrammar(r[5]);             // זורק על ערך לא-מוכר שאינו placeholder
    const existing = cl[code] || {};
    const entry = { ...existing };
    entry.name = norm(r[1]) || existing.name || '';
    entry.name_en = norm(r[2]) || existing.name_en || '';
    if (norm(r[4]) && !isPlaceholder(r[4])) entry.contact = norm(r[4]);
    else if (existing.contact) entry.contact = existing.contact;
    if (grammar) { entry.gender = grammar.gender; entry.number = grammar.number; }
    else { entry.gender = existing.gender || 'm'; entry.number = existing.number || 'p'; }
    if (norm(r[6]) && !isPlaceholder(r[6])) entry.phrasing = norm(r[6]);
    if (norm(r[7])) entry.notes = norm(r[7]);
    // מיילים אמיתיים מהגיליון (מאושר 2026-07-07); placeholder => override נשאר
    const realEmails = splitEmails(r[3]);
    entry.emails = realEmails.length ? realEmails
      : (existing.emails && existing.emails.length) ? existing.emails : [OVERRIDE];
    // needs_review: אם מיילים/מגדר עדיין placeholder — ממתין לפרטים
    const pending = !realEmails.length || grammar === null;
    if (pending) entry.needs_review = true; else if ('needs_review' in existing) entry.needs_review = existing.needs_review;

    const isNew = !cl[code];
    cl[code] = entry;
    (isNew ? out.coloaders.added : out.coloaders.updated).push(`${code} ${entry.name}`);
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

// ---------- מסופים ----------
// מיפוי DELIVERY PLACE / שם -> key פנימי (כפי שמופיע ב-terminals.json הקיים)
function terminalKeyOf(deliveryPlace, name) {
  const dp = norm(deliveryPlace).toUpperCase();
  const nm = norm(name);
  if (/OVERSEAS/.test(dp) || /אוברסיז/.test(nm)) return 'overseas';
  if (/GOLD ?BOND|CONTR/.test(dp) || /גולד\s*בונד|קונטרם/.test(nm)) return 'goldbond';
  if (/MASOF ?207|207/.test(dp) || /207/.test(nm)) return 'masof207';
  if (/PORT/.test(dp) || /נמל/.test(nm)) return 'port';
  if (/בונדד/.test(nm)) return 'bonded';
  if (/סויספורט|SWISS/i.test(nm)) return 'swissport';
  if (/סמא|SME/i.test(nm)) return 'sme';
  if (/סדצקי|SADETSKY/i.test(nm)) return 'sadetsky';
  return null;
}

function importTerminals(wb, out) {
  const rows = readSheet(wb, 'מסופים');
  const file = path.join(CONFIG_DIR, 'terminals.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const terms = doc.terminals;
  doc.haifa_terminals = doc.haifa_terminals || {};

  // אינדקס entries קיימים לפי key להעשרה. מפתח אחד עשוי להופיע בכמה רשומות —
  // המפתח הקצר (כפי שבדוח) + שמות ה-Focus הארוכים שנוספו כ-mirror. מחזיקים את כולם
  // ומעדכנים את כולם, אחרת מיילים אמיתיים נכתבים רק ל-mirror והמסווג (שמאתר לפי
  // השם הקצר) ממשיך לראות את ה-override.
  const byKey = {};
  for (const [k, v] of Object.entries(terms)) {
    if (!v.key) continue;
    (byKey[v.key] = byKey[v.key] || []).push({ k, v });
  }

  // M: שם(0) מיקום(1) מיילים(2) תפקיד(3) DELIVERY PLACE(4) הערות(5)
  let region = 'ashdod';
  for (const r of rows) {
    const name = norm(r[0]);
    if (/מסופי חיפה/.test(name)) { region = 'haifa'; continue; }
    if (/מסופי אשדוד/.test(name)) { region = 'ashdod'; continue; }
    if (!name || /^שם המסוף/.test(name) || /טבלת מסופים/.test(name)) continue;

    const key = terminalKeyOf(r[4], name);
    const realEmails = splitEmails(r[2]); // מיילים אמיתיים (מאושר); ריק => placeholder
    const meta = {
      location: norm(r[1]) || undefined,
      role: norm(r[3]) || undefined,
      delivery_place: norm(r[4]) || undefined,
      notes: norm(r[5]) || undefined,
    };
    Object.keys(meta).forEach((k) => meta[k] === undefined && delete meta[k]);

    if (region === 'haifa') {
      // מסופי יעד בחיפה — מידע בלבד (לא מפתחות lookup לניתוב)
      doc.haifa_terminals[name] = { key: key || null, ...meta, emails: realEmails.length ? realEmails : [OVERRIDE] };
      out.terminals.haifa.push(`${name}${key ? ' ('+key+')' : ''}`);
      continue;
    }

    // אשדוד — מעשירים את כל ה-entries של אותו key (השם הקצר + כל mirror), ומוסיפים
    // את השם הארוך כמפתח נוסף אם חסר
    if (key && byKey[key]) {
      for (const { k, v: ex } of byKey[key]) {
        Object.assign(ex, meta);                     // מטא-דאטה
        // מיילים אמיתיים מהגיליון — רק כשנמצאו; מסוף שממילא בלי מיילים (masof207) לא נדרס
        if (realEmails.length && (ex.emails || []).length) ex.emails = realEmails;
        ex.aliases = Array.from(new Set([...(ex.aliases || []), name]));
        out.terminals.enriched.push(`${k} <= ${name}`);
      }
    }
    // אם השם הארוך אינו כבר מפתח קיים — מוסיפים אותו כמפתח נוסף, ממורה לאותו ניתוב
    if (!terms[name]) {
      const routing = key && byKey[key] ? byKey[key][0].v : {};
      terms[name] = {
        key: key || null,
        downloader: routing.downloader,
        emails: realEmails.length ? realEmails
          : (routing.emails && routing.emails.length) ? routing.emails : [OVERRIDE],
        ...(routing.always_with_coloader ? { always_with_coloader: true } : {}),
        ...(key ? {} : { needs_review: true }),
        ...meta,
      };
      Object.keys(terms[name]).forEach((k) => terms[name][k] === undefined && delete terms[name][k]);
      out.terminals.added.push(`${name}${key ? ' ('+key+')' : ' (?)' }`);
    }
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

// ---------- מובילי המשך ----------
function canonicalCarrier(label) {
  const s = String(label || '');
  if (/סמא|SME/i.test(s)) return 'סמא';
  if (/גולד\s*בונד/.test(s)) return 'גולד בונד';
  if (/סדצקי/.test(s)) return 'סדצקי';
  return null;
}
function importContinuation(wb, out) {
  const rows = readSheet(wb, 'מובילי המשך');
  const file = path.join(CONFIG_DIR, 'terminals.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cc = doc.continuation_carriers;
  doc.continuation_carriers_extra = doc.continuation_carriers_extra || {};

  // C: שם(0) מיילים(1) ניסוח מכותרת(2) לקוחות(3) הערות(4)
  for (const r of rows) {
    const label = norm(r[0]);
    if (!label || /^שם מוביל/.test(label) || /טבלת מובילי/.test(label)) continue;
    const canon = canonicalCarrier(label);
    const realEmails = splitEmails(r[1]); // מיילים אמיתיים (מאושר)
    const meta = {
      phrasing: norm(r[2]) || undefined,
      main_customers: norm(r[3]) || undefined,
      notes: norm(r[4]) || undefined,
    };
    Object.keys(meta).forEach((k) => meta[k] === undefined && delete meta[k]);

    if (canon && cc[canon]) {
      Object.assign(cc[canon], meta);                // מעשירים קנוני קיים
      if (realEmails.length) cc[canon].emails = realEmails;
      out.continuation.enriched.push(`${canon} <= ${label}`);
    } else {
      // מוביל שאינו אחד השלושה הקנוניים (TLS / מירב / הדס) — מידע בלבד
      doc.continuation_carriers_extra[label] = { ...meta, emails: realEmails.length ? realEmails : [OVERRIDE] };
      out.continuation.extra.push(label);
    }
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

function main() {
  if (!fs.existsSync(XLSX_PATH)) { console.error('לא נמצא קובץ:', XLSX_PATH); process.exit(1); }
  const wb = XLSX.readFile(XLSX_PATH);
  const out = {
    coloaders: { added: [], updated: [], skipped: [] },
    terminals: { enriched: [], added: [], haifa: [] },
    continuation: { enriched: [], extra: [] },
  };
  importCoLoaders(wb, out);
  importTerminals(wb, out);
  importContinuation(wb, out);

  console.log('=== import-carriers-terminals ===');
  console.log('קובץ:', XLSX_PATH);
  console.log('CO-LOADERS  — נוספו:', out.coloaders.added.length, '| עודכנו:', out.coloaders.updated.length, '| דולגו:', JSON.stringify(out.coloaders.skipped));
  console.log('  added  :', JSON.stringify(out.coloaders.added));
  console.log('  updated:', JSON.stringify(out.coloaders.updated));
  console.log('מסופים      — הועשרו:', JSON.stringify(out.terminals.enriched));
  console.log('  נוספו (אשדוד):', JSON.stringify(out.terminals.added));
  console.log('  חיפה (מידע)  :', JSON.stringify(out.terminals.haifa));
  console.log('מובילי המשך — הועשרו:', JSON.stringify(out.continuation.enriched), '| נוספים:', JSON.stringify(out.continuation.extra));
}

main();
