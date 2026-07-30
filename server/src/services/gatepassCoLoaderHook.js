/**
 * services/gatepassCoLoaderHook.js — מגשר בין הגעת gatepass PDF חדש (gatepassFetcher)
 * לבין יישוב קוד הקו-לואדר (report/gatepassCoLoaderDecision) וחידוש הטיוטה (composer),
 * בלי ש-gatepassFetcher.js עצמו יכיר את שכבת הדוח/מסווג/קומפוזר.
 *
 * נקרא ברגע שה-PDF נשמר לראשונה, *לפני* שה-status עובר מ"ממתין ל-PDF" ל-pending_approval
 * (setGatepass היא נקודת המעבר היחידה — ראו db/shipments.js) — כך שאם ההחלטה היא hold
 * (mismatch/extraction_failed), התיק לעולם לא מגיע לתור האישורים עם טיוטה לא-מאומתת.
 *
 * רק תיקי co_loader/terminal רלוונטיים (מסלולי העברה-לחיפה שבהם קוד קו-לואדר משנה
 * ניתוב) — תיקים אחרים (prepaid/direct/alert) לא נוגעים בכלל בפונקציה הזו.
 */
const shipments = require('../db/shipments');
const importersDb = require('../db/importers');
const { readReport } = require('../report/reader');
const { classify } = require('../report/classifier');
const { composeRelease } = require('../email/composer');
const { resolveCoLoader } = require('../report/gatepassCoLoaderDecision');
const { parseGatepassPdf } = require('./gatepassParser');
const { REPORT_PATH } = require('../config');

const TRANSFER_ROUTES = new Set(['co_loader', 'terminal']);

/**
 * resolveCoLoaderFromPdf — מריץ את החילוץ+ההחלטה+(אם רלוונטי) חידוש הטיוטה עבור
 * תיק שזה עתה קיבל gatepass PDF. אינו נוגע ב-status — הקריאה מ-gatepassFetcher
 * ממשיכה ל-setGatepass כרגיל אחרי זה (או, במקרה hold, setGatepass עדיין מריץ את
 * המעבר הסטנדרטי, אך הטיוטה תישאר ללא עדכון קוד-מאומת — ה-reason ב-DB מתעד את ה-hold
 * לצורך תצוגה/ניפוי, וה-gate של האוטומציה בודק gatepass_co_loader_rule לפני שליחה).
 *
 * מחזיר את תוצאת ה-resolveCoLoader (או null אם התיק אינו co_loader/terminal — לא רלוונטי).
 */
async function resolveCoLoaderFromPdf(fileNumber, pdfPath) {
  const ship = shipments.get(fileNumber);
  if (!ship || !TRANSFER_ROUTES.has(ship.route)) return null;

  const parseResult = await parseGatepassPdf(pdfPath, fileNumber);

  let reportRec = null;
  try {
    const { records } = readReport(REPORT_PATH);
    reportRec = records.find((r) => String(r.file_number) === String(fileNumber)) || null;
  } catch {
    reportRec = null; // הדוח לא נגיש כרגע — ממשיכים עם co_loader_code הידוע מה-DB בלבד
  }
  const existingCode = reportRec ? reportRec.co_loader_code : (ship.co_loader_code || '');

  const decision = resolveCoLoader(existingCode, parseResult);

  shipments.setGatepassParseResult(fileNumber, {
    dealId: decision.dealId, coLoaderCode: parseResult.coLoaderCode || null, rule: decision.rule,
  });

  if (decision.hold) {
    console.warn(`[gatepassCoLoaderHook] תיק ${fileNumber} — hold (${decision.rule}): ${decision.reason}`);
    return decision;
  }

  // match/adopt/terminal — מחדשים את הטיוטה אם קוד הקו-לואדר האפקטיבי השתנה
  if (!reportRec) return decision; // אין רשומת דוח טרייה לחדש ממנה — הקוד נשמר, הטיוטה נשארת כפי שהיא
  const effectiveRec = { ...reportRec, co_loader_code: decision.resolvedCoLoaderCode || '' };
  const importer = importersDb.findByName(effectiveRec.customer_name);
  const newDecision = classify(effectiveRec, importer);
  if (newDecision.route !== 'co_loader' && newDecision.route !== 'terminal') return decision;

  const email = composeRelease(effectiveRec, newDecision, importer);
  let payload = {};
  try { payload = ship.draft_payload ? JSON.parse(ship.draft_payload) : {}; } catch { payload = {}; }
  payload.email = email;
  payload.route = newDecision.route;
  payload.needs_review = !!newDecision.needs_review;

  shipments.upsert({
    file_number: fileNumber,
    route: newDecision.route,
    co_loader_code: decision.resolvedCoLoaderCode || null,
    draft_payload: payload,
  });
  return decision;
}

module.exports = { resolveCoLoaderFromPdf };
