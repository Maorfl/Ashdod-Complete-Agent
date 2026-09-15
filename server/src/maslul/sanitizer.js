/**
 * maslul/sanitizer.js — ניקוי ואימות ערכים ברמת התו (מפרט §8).
 * כל חריגה מחזירה שגיאה עם קוד — הערך לא נכתב והשורה נחסמת.
 */

// תווים בלתי נראים שיש להסיר: NBSP, TAB, CR, LF, LRM, RLM, ZWSP, BOM
const INVISIBLE_RE = /[\u00A0\t\r\n\u200E\u200F\u200B\uFEFF]/g;

/** ניקוי בסיסי לכל ערך טקסט: הסרת בלתי-נראים, trim, כיווץ רווחים כפולים. */
function clean(value, { collapseSpaces = true } = {}) {
  let s = String(value == null ? '' : value);
  s = s.replace(INVISIBLE_RE, ' ');
  if (collapseSpaces) s = s.replace(/ {2,}/g, ' ');
  return s.trim();
}

const PRINTABLE_ASCII_RE = /^[\x20-\x7E]*$/;

/** A — פרט מכס: בדיוק 12 תווים בתבנית ^\d{10}/\d$ */
function validateA(value) {
  const v = clean(value);
  if (v.length !== 12) return { ok: false, code: 'E06', value: v, message: `פרט מכס חייב להיות באורך 12 תווים (התקבל ${v.length}): "${v}"` };
  if (!/^\d{10}\/\d$/.test(v)) return { ok: false, code: 'E06', value: v, message: `פרט מכס חייב להיות במבנה 10 ספרות, לוכסן, ספרה: "${v}"` };
  return { ok: true, value: v };
}

/** B — קוד דגם: עד 35 תווים, ASCII מודפס בלבד (אין עברית — לפי הנחיית התבנית) */
function validateB(value) {
  const v = clean(value);
  if (v.length > 35) return { ok: false, code: 'E06', value: v, message: `קוד דגם ארוך מ-35 תווים (${v.length}): "${v}"` };
  if (!PRINTABLE_ASCII_RE.test(v)) return { ok: false, code: 'E06', value: v, message: `קוד דגם חייב להיות אנגלית/ספרות/תווי מקלדת בלבד: "${v}"` };
  return { ok: true, value: v };
}

/** C — תיאור טובין: עד 140, ללא ירידת שורה (כבר הוסרה בניקוי) */
function validateC(value) {
  const v = clean(value);
  if (v.length > 140) return { ok: false, code: 'E06', value: v, message: `תיאור טובין ארוך מ-140 תווים (${v.length}): "${v}"` };
  return { ok: true, value: v };
}

/**
 * _fmt_num — פורמט מספר לכתיבה ל-XML (פורט מ-§7.3).
 * ללא מפרידי אלפים, ללא כתיב מדעי, עד 2 עשרוניות, לא שלילי.
 * מימוש עם מספרים שלמים (סנטים) במקום Decimal של פייתון — נמנע מרעשי float.
 */
function fmtNum(v) {
  if (v === null || v === undefined || v === '') throw new Error('מספר ריק');
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`מספר לא חוקי: ${JSON.stringify(v)}`);
  if (s.startsWith('-')) throw new Error(`מספר לא חוקי (שלילי): ${s}`);
  const [intPart, fracRaw = ''] = s.split('.');
  if (fracRaw.length > 2) throw new Error(`מספר לא חוקי (יותר מ-2 עשרוניות): ${s}`);
  const frac = fracRaw.replace(/0+$/, '');
  const int = intPart.replace(/^0+(?=\d)/, '');
  return frac ? `${int}.${frac}` : int;
}

/** D/E/F — כמות: 9 ספרות לפני הנקודה, 2 אחריה. G — 10 ספרות. */
function validateNum(value, col) {
  let formatted;
  try {
    formatted = fmtNum(value);
  } catch (e) {
    return { ok: false, code: 'E07', value: String(value), message: `${col}: ${e.message}` };
  }
  const maxIntDigits = col === 'G' ? 10 : 9;
  const intDigits = formatted.split('.')[0].length;
  if (intDigits > maxIntDigits) {
    return { ok: false, code: 'E07', value: formatted, message: `${col}: יותר מ-${maxIntDigits} ספרות לפני הנקודה: "${formatted}"` };
  }
  return { ok: true, value: formatted };
}

/** XML escape לערכי טקסט (§7.3) */
function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * פירסור מספר אירופי: "2.688" -> 2688 ; "1.715,27" -> 1715.27
 * נקודה = מפריד אלפים, פסיק = עשרוני.
 */
function parseEuroNumber(raw) {
  return parseNumber(raw, 'eu');
}

/**
 * parseNumber — פענוח מספר לפי פורמט מפורש.
 *
 * 'eu'  — פורמט אירופי: '.' = מפריד אלפים, ',' = עשרוני   (1.715,27 -> 1715.27)
 * 'anglo' — פורמט אנגלי: ',' = מפריד אלפים, '.' = עשרוני  (43,740.85 -> 43740.85)
 *
 * חשבונות Unilever מגיעים בשני הפורמטים (ראו detectNumberFormat) — פענוח בפורמט
 * הלא נכון מחזיר מספר שגוי פי 1000 ולא שגיאה, ולכן הפורמט חייב להיקבע לכל החשבון
 * מראש ולא להיגזר פר-מספר.
 */
function parseNumber(raw, format) {
  if (raw == null) return null;
  const s = String(raw).replace(/[\s ]/g, '');
  if (!s) return null;
  const thou = format === 'anglo' ? ',' : '.';
  const dec = format === 'anglo' ? '.' : ',';
  const t = thou === '.' ? String.raw`\.` : ',';
  const d = dec === '.' ? String.raw`\.` : ',';
  const re = new RegExp(String.raw`^\d{1,3}(${t}\d{3})*(${d}\d+)?$|^\d+(${d}\d+)?$`);
  if (!re.test(s)) return null;
  const normalized = s.split(thou).join('').replace(dec, '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * detectNumberFormat — מזהה את פורמט המספרים של החשבון מתוך הטקסט כולו.
 *
 * ההכרעה נשענת רק על מספרים חד-משמעיים:
 *  - '1.234,56' / '1,234.56'  — שני המפרידים יחד: המפריד האחרון הוא העשרוני.
 *  - מפריד יחיד שאחריו מספר ספרות ≠ 3 (למשל '0,00' או '43.7') — הוא העשרוני.
 * '646.060' או '11,284' אינם ראיה (יכולים להיות אלפים או 3 ספרות עשרוניות)
 * ולכן נספרים כלא-מכריעים ומתעלמים מהם.
 *
 * ברירת המחדל בהיעדר ראיה היא 'eu' — הפורמט של החשבונות ההיסטוריים.
 */
function detectNumberFormat(text) {
  const s = String(text || '');
  let eu = 0;
  let anglo = 0;

  // שני מפרידים יחד — הראיה החזקה ביותר
  for (const m of s.matchAll(/\d[\d.,]*\d/g)) {
    const tok = m[0];
    const lastDot = tok.lastIndexOf('.');
    const lastComma = tok.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastComma > lastDot) eu += 3; else anglo += 3;
      continue;
    }
    // מפריד יחיד שאחריו מספר ספרות שאינו 3 — חייב להיות עשרוני
    const sep = lastDot >= 0 ? lastDot : lastComma;
    if (sep < 0) continue;
    const frac = tok.length - sep - 1;
    if (frac === 3) continue; // דו-משמעי
    if (lastDot >= 0) anglo += 1; else eu += 1;
  }

  if (anglo > eu) return 'anglo';
  if (eu > anglo) return 'eu';
  return 'eu';
}

/** ספרת ביקורת EAN-13 */
function validateEan13(ean) {
  const s = String(ean || '').replace(/\D/g, '');
  if (s.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

module.exports = {
  clean, validateA, validateB, validateC, validateNum,
  fmtNum, xmlEscape, parseEuroNumber, parseNumber, detectNumberFormat,
  validateEan13, INVISIBLE_RE,
};
