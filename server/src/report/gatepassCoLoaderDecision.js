/**
 * report/gatepassCoLoaderDecision.js — מיישם את 5 כללי ההחלטה (Task 2, תוספת
 * gatepass-PDF): לפני בניית/חידוש טיוטת "העברה לחיפה", מיישבים את קוד הקו-לואדר
 * של התיק (מהדוח) מול הקוד שחולץ מה-PDF (services/gatepassParser).
 *
 * כלל 1 — יש קוד בתיק, ותואם לקוד מה-PDF → co_loader (כרגיל).
 * כלל 2 — אין קוד בתיק, קוד ה-PDF מוכר במערכת → מאמצים אותו (co_loader).
 * כלל 3 — אין קוד בתיק, קוד ה-PDF לא מוכר/לא קיים → מסוף השחרור (terminal).
 * כלל 4 — יש קוד בתיק, אך *לא* תואם לקוד מה-PDF → hold (בדיקה ידנית, שני הקודים
 *   גלויים בסיבה). לא מנחשים מי צודק — ניתוב שגוי שולח מייל אמיתי לחברה הלא נכונה.
 * כלל 5 — החילוץ מה-PDF נכשל כליל (אין טקסט/אין מזהה/אורך שגוי) → hold.
 *
 * *לא* משתמש אף פעם ב-rec.deal_id (Deal ID מהדוח) — נבדק אמפירית כנושא קבוע
 * שאינו קוד הקו-לואדר בפועל (ראו gatepassParser.js לפירוט המלא).
 */
const contacts = require('../db/contacts');

/**
 * @param existingCoLoaderCode - rec.co_loader_code מהדוח (מחרוזת ריקה/undefined אם אין)
 * @param parseResult - תוצאת services/gatepassParser.parseGatepassPdf: { dealId, coLoaderCode } או { error }
 * @returns {{
 *   rule: 'match'|'adopt'|'terminal'|'mismatch_hold'|'extraction_failed',
 *   resolvedCoLoaderCode: string|null,  // הקוד שיש להשתמש בו (null אם hold/terminal)
 *   hold: boolean,                      // true => לא בונים/מחדשים טיוטת העברה לחיפה
 *   reason: string|null,                // סיבה קריאה-לאדם, למקרי hold בלבד
 *   dealId: string|null,
 * }}
 */
function resolveCoLoader(existingCoLoaderCode, parseResult) {
  const existing = String(existingCoLoaderCode || '').trim();
  const dealId = parseResult?.dealId || null;

  // כלל 5 — חילוץ נכשל כליל
  if (!parseResult || parseResult.error) {
    const reasonByError = {
      file_not_found: 'קובץ ה-PDF לא נמצא בדיסק',
      pdf_read_failed: 'שגיאה בקריאת קובץ ה-PDF',
      no_delivery_note_page: 'לא נמצא עמוד "תעודת משלוח" ב-PDF',
      file_number_not_in_pdf: 'מספר התיק אינו מופיע בטקסט ה-PDF — ייתכן שה-PDF שייך לתיק אחר',
      no_deal_id: 'לא נמצא מזהה עסקה בן 16 תווים בעמוד "תעודת משלוח"',
      ambiguous_deal_id: 'נמצא יותר ממזהה עסקה אחד אפשרי בעמוד — לא ניתן לקבוע באופן חד-משמעי',
      no_text: 'לא ניתן לחלץ טקסט מה-PDF (גם לא ב-OCR)',
    };
    const err = parseResult?.error || 'unknown';
    return {
      rule: 'extraction_failed',
      resolvedCoLoaderCode: null,
      hold: true,
      reason: `חילוץ קוד קו-לואדר מה-PDF נכשל: ${reasonByError[err] || err}`,
      dealId,
    };
  }

  const pdfCode = String(parseResult.coLoaderCode || '').trim();

  // כלל 1 — יש קוד בתיק, תואם ל-PDF
  if (existing && existing === pdfCode) {
    return { rule: 'match', resolvedCoLoaderCode: existing, hold: false, reason: null, dealId };
  }

  // כלל 4 — יש קוד בתיק, לא תואם ל-PDF — hold, לא מנחשים
  if (existing && existing !== pdfCode) {
    return {
      rule: 'mismatch_hold',
      resolvedCoLoaderCode: null,
      hold: true,
      reason: `קוד ה-CO-LOADER בתיק (${existing}) אינו תואם לתעודת המשלוח (${pdfCode})`,
      dealId,
    };
  }

  // אין קוד בתיק — כלל 2 (מאמצים קוד PDF מוכר) או כלל 3 (מסוף)
  const known = pdfCode && contacts.getCoLoaderByCode(pdfCode);
  if (known) {
    return { rule: 'adopt', resolvedCoLoaderCode: pdfCode, hold: false, reason: null, dealId };
  }
  return { rule: 'terminal', resolvedCoLoaderCode: null, hold: false, reason: null, dealId };
}

module.exports = { resolveCoLoader };
