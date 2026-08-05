/**
 * services/gatepassParser.js — חילוץ קוד CO-LOADER מתוך ה-gatepass PDF (מזהה עסקה
 * שמופיע בתחתית עמוד "תעודת משלוח"), כאימות/מקור נוסף לקוד קו-לואדר של התיק.
 *
 * ⚠️ למה לא Deal ID מהדוח: נבדק אמפירית מול 20 רשומות בדוח עם גם Deal ID וגם קוד
 * קו-לואדר — לכולן יש את הקבוע "267" בתווים 11-13 של ה-Deal ID, ללא קשר לקוד
 * הקו-לואדר האמיתי שלהן (641/415/674/635/237). ה-Deal ID בדוח אינו נושא את קוד
 * הקו-לואדר בפועל — ולכן rec.deal_id (report/reader.js) אינו רלוונטי כלל לתכונה זו.
 *
 * המקור האמיתי: ה-PDF עצמו מכיל *שני* מזהי-עסקה בני 16 תווים בשני עמודים שונים:
 *   עמוד 0 ("תעודת משלוח") — מזהה עם הקוד האמיתי בתווים 11-13 (מאומת מול 15 קבצי
 *     PDF אמיתיים מול קוד הקו-לואדר הידוע ב-DB — התאמה מלאה בכולם, ראו סיכום המשימה).
 *   עמוד 1 ("תעודת שער") — מזהה *שונה* שנושא את אותו "267" קבוע כמו ה-Deal ID בדוח.
 * לכן קריטי לחלץ מעמוד 0 בלבד, מזוהה לפי המחרוזת הייחודית "משלוח תעודת" (מופיעה
 * רק בעמוד 0 בכל 21 הקבצים שנבדקו; "שער תעודת" מופיע בשניהם ולכן אינו סמן ייחודי).
 *
 * חוק החילוץ: coLoaderCode = dealId.slice(10, 13) — תווים 11,12,13 (1-indexed),
 * ללא תלות באות (למשל "A") שלעיתים מופיעה במיקום 14 — לא תמיד קיימת, לא נסמכים עליה.
 *
 * מגבלה ידועה: קוד 15373 (SPARTA CARGO) הוא בן 5 ספרות ולעולם לא יתאים לחילוץ בן
 * 3 תווים — כשהחילוץ אינו תואם אף קוד ידוע, זו התנהגות צפויה (לא תמיד תקלה), אך
 * נרשמת ללוג במפורש כדי שהדפוס יהיה נראה ולא שקוף (ראו logUnmatchedCode).
 */
const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const contacts = require('../db/contacts'); // מקור אמת יחיד ל-co-loaders (חי, ראו contacts.js)

// שכבת הטקסט של ה-PDF מחזירה את המילים בסדר הפוך ("משלוח תעודת") בגלל אופן אחסון
// רצפי RTL; OCR (מסלול הגיבוי) מחזיר את אותו כיתוב בסדר הקריאה הטבעי ("תעודת משלוח").
// שתי הצורות תקפות ומזהות את אותו עמוד — בדיקה מול שתיהן, אחרת מסלול ה-OCR תמיד
// ייפול על no_delivery_note_page ולעולם לא יגיע לחילוץ המזהה.
const DELIVERY_NOTE_MARKER = 'משלוח תעודת';
const DELIVERY_NOTE_MARKERS = [DELIVERY_NOTE_MARKER, 'תעודת משלוח'];
const hasDeliveryNoteMarker = (text) => DELIVERY_NOTE_MARKERS.some((m) => String(text || '').includes(m));
const DEAL_ID_RE = /[A-Za-z0-9]{16}/g;

/**
 * extractDealId — מוצא את המזהה בן-16-התווים בעמוד "תעודת משלוח" (עמוד 0 בפועל
 * בכל הקבצים שנבדקו, אך מחפשים לפי הכותרת ולא לפי אינדקס עמוד קבוע — למקרה של
 * וריאציה עתידית בסדר העמודים).
 * מחזיר { dealId } או { error }.
 */
async function extractFromText(pages, fileNumber) {
  const notePage = pages.find((p) => hasDeliveryNoteMarker(p.text));
  if (!notePage) return { error: 'no_delivery_note_page' };

  // אימות שה-PDF שייך לתיק הנכון (הצעת בדיקת-שפיות): מספר התיק חייב להופיע
  // במפורש בטקסט העמוד — סוגר פער אפשרי בהתאמת gatepassFetcher לפי נושא מייל בלבד.
  if (fileNumber && !notePage.text.includes(String(fileNumber))) {
    return { error: 'file_number_not_in_pdf' };
  }

  const candidates = notePage.text.match(DEAL_ID_RE) || [];
  // המזהה תמיד באורך 16 בדיוק — פוסלים כל דבר אחר (אין ניחוש חלקי)
  const valid = candidates.filter((c) => c.length === 16);
  if (valid.length === 0) return { error: 'no_deal_id' };
  if (valid.length > 1) return { error: 'ambiguous_deal_id', candidates: valid };
  return { dealId: valid[0] };
}

/**
 * parseGatepassPdf — הפונקציה הראשית: קורא PDF מהדיסק, מחלץ טקסט (שכבת טקסט;
 * OCR רק אם אין טקסט שמיש — קבצי gatepass ממערכת ממוחשבת הם כמעט תמיד טקסטואליים),
 * ומחזיר { dealId, coLoaderCode } או { error }. לעולם לא מנחש חלקית.
 */
async function parseGatepassPdf(pdfPath, fileNumber) {
  if (!pdfPath || !fs.existsSync(pdfPath)) return { error: 'file_not_found' };

  let pages;
  try {
    const buf = fs.readFileSync(pdfPath);
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    pages = result.pages || [];
    await parser.destroy();
  } catch (e) {
    return { error: 'pdf_read_failed', detail: e.message };
  }

  const hasText = pages.some((p) => (p.text || '').trim().length > 20);
  if (!hasText) {
    // נפילה ל-OCR רק כשאין שכבת טקסט שמישה — קבצי gatepass ממוחשבים כמעט תמיד
    // טקסטואליים; זהו מסלול edge-case בלבד (services/ocr.js, tesseract.js).
    try {
      const ocr = require('./ocr');
      const text = await ocr.ocrImage(pdfPath);
      if (!text || text.trim().length < 20) return { error: 'no_text' };
      pages = [{ text }];
    } catch (e) {
      return { error: 'no_text', detail: e.message };
    }
  }

  const extracted = await extractFromText(pages, fileNumber);
  if (extracted.error) return extracted;

  const dealId = extracted.dealId;
  if (dealId.length !== 16) return { error: 'bad_length', dealId }; // הגנה כפולה, לא אמור לקרות
  const coLoaderCode = dealId.slice(10, 13);

  if (!contacts.getCoLoaderByCode(coLoaderCode)) {
    // קוד לא מוכר — לעיתים תקין (למשל קוד בן 5 ספרות כמו 15373 שאינו יכול להתאים
    // לחיתוך 3-תווים) ולעיתים מעיד על פער נתונים. נרשם ללוג במפורש כדי שהדפוס יהיה
    // גלוי, לא שקוף — הקורא (Task 2) מחליט מה לעשות עם unknown_code.
    console.log(`[gatepassParser] קוד קו-לואדר לא מוכר מה-PDF: "${coLoaderCode}" (dealId=${dealId}, file=${fileNumber || '?'}) — ייתכן קוד ${coLoaderCode.length < 5 ? 'ארוך מ-3 ספרות (למשל 15373)' : 'לא ממופה'}.`);
    return { dealId, coLoaderCode, unknownCode: true };
  }

  return { dealId, coLoaderCode };
}

module.exports = { parseGatepassPdf, extractFromText, DELIVERY_NOTE_MARKER };
