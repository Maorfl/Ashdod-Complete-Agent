/**
 * maslul/checksums.js — אימותי שפיות לפלט ה-OCR.
 *
 * האימותים האריתמטיים (כמות × מחיר ÷ 1000 = ערך, Σ ארגזים, Σ ערך) בוטלו
 * לפי החלטת המשתמש (2026-09-15): מחירים ומשקלים אינם רלוונטיים לתהליך ואינם
 * נכתבים לקובץ. נותרו רק אימותים שאינם תלויים במחיר: קוד Commodity ו-EAN-13.
 *
 * השלכה מודעת: שורה שה-OCR השמיט לגמרי, או כמות שנקראה שגוי, לא תיתפס
 * אוטומטית — מסך הסקירה ותמונות השורות הם הבדיקה היחידה.
 */
const { validateEan13 } = require('./sanitizer');

const EXPECTED_HS = '33072000';

function checkRows(lines) {
  const results = [];
  for (const l of lines) {
    const issues = [];
    if (l.hs_code !== EXPECTED_HS) {
      issues.push({ code: 'E04', message: `קוד Commodity לא צפוי: "${l.hs_code}" (צפוי ${EXPECTED_HS})` });
    }
    if (l.ean && !validateEan13(l.ean)) {
      issues.push({ code: 'E07', message: `ספרת ביקורת EAN-13 שגויה: "${l.ean}" — ייתכן שהעמודות הוסטו` });
    }
    results.push({ sku: l.sku, item_no: l.item_no, ok: issues.length === 0, issues });
  }
  return results;
}

/**
 * checkTotals — בוטל. מוחזר מבנה ניטרלי כדי לשמור על חוזה ה-review.json
 * מבלי לחסום הפקה בגלל עמוד הסיכום.
 */
function checkTotals() {
  return {
    sumCases: null, sumValue: null, totalCases: null, totalValue: null,
    casesOk: null, valueOk: null, readable: true, disabled: true, errors: [],
  };
}

module.exports = { checkRows, checkTotals, EXPECTED_HS };
