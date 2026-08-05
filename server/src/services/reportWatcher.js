/**
 * services/reportWatcher.js — לולאת ה-polling (מצב 1), בתצורת שני שעונים נפרדים.
 *
 * Task 1 — שעון סריקה (scanOnce): רץ כל poll_interval_minutes (10), קורא ומפרסר את
 *   הדוח אל cache בזיכרון בלבד. אינו נוגע ב-DB.
 * Task 2 — שעון קומיט (commit): רץ בשעון-קיר, 5 דקות לפני תחילת כל שעה (HH:55, לפי
 *   config.commit_before_hour_minutes). לוקח את ה-cache האחרון ומריץ את הצנרת בפועל:
 *   סינון scope → סיווג → upsert ל-DB → בניית טיוטה / שליחה אוטומטית (Task 6).
 *
 * הפרדת שני השעונים מאפשרת סריקה תכופה (רעננות דשבורד) בלי הצפת ה-DB/שליחות,
 * וריכוז כל הכתיבות והשליחות לחלון קומיט אחד צפוי בשעה.
 *
 * תיקי no_op אינם נשמרים ב-DB (לא רלוונטיים לאשדוד) — רק נספרים. אינו שולח דבר
 * בעצמו למעט מסלולי ההעברה לחיפה כשמופעל הדגל auto_send_haifa_transfer (Task 6).
 */
const fs = require('fs');
const configModule = require('../config');
const { config, REPORT_PATH } = configModule;
const { readReport } = require('../report/reader');
const { classify, transferPerformer, isHaifaTransfer, requiresGatepass } = require('../report/classifier');
const { composeRelease } = require('../email/composer');
const importersDb = require('../db/importers');
const shipments = require('../db/shipments');
const graph = require('./graphMail');
const gatepass = require('./gatepassFetcher');
const scope = require('../scope');
const contacts = require('../db/contacts');
const automation = require('./automation');

// pending_approval — תור אישור אנושי; awaiting_gatepass — מסלול העברה שאושר לשליחה
// אוטומטית וממתין להגעת ה-gatepass PDF (Task 4/6). alert — בדיקה ידנית.
const STATUS = { ALERT: 'alert', PENDING: 'pending_approval', AWAITING_GATEPASS: 'awaiting_gatepass', RELEASED: 'שוחרר באשדוד', AWAITING_PDF: shipments.AWAITING_PDF_STATUS };
const TRANSFER_ROUTES = new Set(['co_loader', 'terminal']);

// כלל scope קבוע (config.report_scope): כל שלוש המחלקות/הנציגים נכנסים לצנרת (הגבלת
// נציג בודד הוסרה - 2026-07-07 - הייתה טעות, ראו _comment ב-config.json). תחנת מכס 2
// נאכפת בנפרד ע"י כלל ה-no_op במסווג.
function normRep(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function inScope(rec) {
  const s = config.report_scope || {};
  // (2026-07-13, אישור משתמש) גם תיקי FCL של אשדוד נכנסים למעקב לתצוגה בדשבורד —
  // ה-fcl_lcl כבר אינו מסנן החוצה. הוא קובע רק זכאות *טיוטה* (isHaifaTransfer דורש LCL).
  // אשדוד-בלבד (תחנת מכס 2) נאכף ע"י כלל ה-no_op במסווג; FCL מסלולי ההעברה נספרים בלבד.
  // רק 19 לקוחות ההעברה לחיפה — מקור אמת יחיד ב-scope.js (משותף לשכבת ההגשה)
  if (!scope.isWhitelisted(rec.customer_name)) return false;
  return true;
}

// מיפוי נציג-דוח (service_rep) -> מחלקה (cus1/cus2/cus3), לפי config.departments.
// נבנה מחדש בכל קריאה (Task 1: config.json עשוי להתעדכן חי בזמן ריצה — ראו config.js
// refreshIfChanged) — אובייקט זעיר (2-3 מחלקות), עלות מחדש הבנייה זניחה.
function repToDept(serviceRep) {
  const map = {};
  for (const [dept, info] of Object.entries(config.departments || {})) {
    if (info?.name) map[normRep(info.name)] = dept;
  }
  return map[normRep(serviceRep)] || null;
}

/**
 * departmentFor — קובע מחלקה לתיק: קודם מהיבואן הידוע (importer.department), ואם חסר —
 * נגזר מ-service_rep הדוח (config.departments). כך תיק של יבואן לא-ממופה (או שהמיפוי
 * שלו עדיין type:unknown/ריק) לא מקבל לעולם department:null ונעלם משכבת התצוגה/הסינון
 * (AgentFilterContext.matchesAgent בצד הלקוח). לעולם אינו נוגע באוטומציה — משמש רק
 * לתיוג/תצוגה; שער האוטומציה ממשיך להישען על automation.isEligible + מצב-מחלקה בפועל.
 */
function departmentFor(rec, importer) {
  return importer?.department || repToDept(rec.service_rep) || null;
}

// ---------- Task 1: cache סריקה (ללא נגיעה ב-DB) ----------
let scanCache = null; // { records, scannedAt, error, path }

function scanOnce() {
  if (!fs.existsSync(REPORT_PATH)) {
    // נתיב הדוח (למשל G:\...\ASHDODAGENT.CSV) עשוי להיות בלתי נגיש מחוץ לפרודקשן —
    // מדווחים בבירור ולא קורסים.
    console.warn(`[reportWatcher] scan: report not found at ${REPORT_PATH}`);
    scanCache = { records: [], scannedAt: new Date().toISOString(), error: 'report_missing', path: REPORT_PATH };
    return scanCache;
  }
  try {
    const { records } = readReport(REPORT_PATH);
    scanCache = { records, scannedAt: new Date().toISOString(), error: null, path: REPORT_PATH, count: records.length };
  } catch (e) {
    console.error(`[reportWatcher] scan failed: ${e.message}`);
    scanCache = { records: [], scannedAt: new Date().toISOString(), error: e.message, path: REPORT_PATH };
  }
  return scanCache;
}

// האם ה-cache ריק/ישן/שגוי ולכן דרושה סריקה מיידית לפני קומיט?
function scanCacheStale() {
  if (!scanCache || scanCache.error) return true;
  const staleMs = (config.poll_interval_minutes || 10) * 60 * 1000 * 2;
  return (Date.now() - Date.parse(scanCache.scannedAt)) > staleMs;
}

/**
 * מצב האוטומציה של מחלקה: off / dry_run / on — נקרא חי מ-services/automation.js
 * (data/automation.json), לא מ-config.json. kill switch גלובלי הופך הכל ל-off
 * (automation.effectiveDeptMode כבר מטפל בזה).
 * off — לא רץ בכלל; dry_run — רץ במלואו, כולל בניית המייל, אך לא שולח ולא מסמן נשלח
 * (רק רושם ל-dry_run_log); on — שליחה אמיתית כרגיל (Task 6).
 */
function autoSendModeForDept(dept) {
  return automation.effectiveDeptMode(dept);
}

// כללי gatepass-coloader (report/gatepassCoLoaderDecision) שנחשבים "מאומתים" לצורך
// זכאות אוטומציה — mismatch_hold/extraction_failed לעולם לא זכאים (וגם ריק/לא-נבדק).
const VERIFIED_COLOADER_RULES = new Set(['match', 'adopt', 'terminal']);

/**
 * importerReadyForAutoSend — תנאי הזכאות של היבואן לשליחה אוטומטית (Task 2, נפרד
 * במכוון מ-importersDb.needsCompletion שמניע את תג התצוגה בדשבורד — 2026-07-30,
 * הבהרת משתמש: "צמצום התג אסור לצמצם את השער"). זכאי כש:
 *   - יש מוביל המשך שנפתר בפועל (cont_general או cont_general_emails) — כלומר
 *     resolveContinuation תניב נמען אמיתי, לא רק ברירת מחדל טכנית; או
 *   - type='haifa_self' (אין מוביל המשך צד-שלישי מלכתחילה) עם מייל יבואן קיים.
 * יבואן ללא אחד מאלה (type='unknown' בלי מוביל המשך, וכו') אינו זכאי — נשאר
 * מוחזק לטיפול אנושי, גם אם יש לו מיילים (ולכן אינו מוצג עם התג "נדרש להשלים").
 */
function importerReadyForAutoSend(importer) {
  if (!importer) return false;
  const hasEmails = Array.isArray(importer.emails) && importer.emails.length > 0;
  if (importer.type === 'haifa_self') return hasEmails;
  const hasContinuation = !!(String(importer.cont_general || '').trim()
    || (Array.isArray(importer.cont_general_emails) && importer.cont_general_emails.length));
  return hasContinuation;
}

/**
 * האם מסלול+מחלקה זכאים לאוטומציה (dry_run או on)?
 *   route ∈ co_loader/terminal + Graph מחובר + מצב המחלקה ≠ off + auto_send_excluded=false
 * (automation.isEligible — מנגנון יחיד, ראו services/automation.js) + קוד הקו-לואדר
 * אומת מול ה-gatepass PDF (gatepass_co_loader_rule ∈ match/adopt/terminal — תוספת
 * gatepass-coloader). תיק שה-PDF שלו טרם נותח, או שנותח והתגלה mismatch/כישלון חילוץ,
 * אינו זכאי לשליחה אוטומטית — נשאר מוחזק לטיפול אנושי, ללא קשר לשאר התנאים.
 * dry_run *אינו* תלוי בחיבור Graph בפועל לשליחה (אין שליחה), אך כן דורש אותו כדי
 * שסימולציה תשקף במדויק את מה שהיה קורה בפועל (למשל אם Graph כבוי, on לא היה שולח בכלל).
 *
 * shipmentRec — הרשומה מה-DB (חייבת את השדות auto_send_excluded/gatepass_co_loader_rule).
 * כשמדובר בתיק חדש שטרם נכתב ל-DB באותו מחזור, יש להעביר את הרשומה *אחרי* ה-upsert
 * הראשוני (ראו קריאה ב-commit למטה) — כך שהשדות קיימים ולא undefined.
 *
 * importer — רשומת היבואן (Task 2, 2026-07-30): נבדק דרך importerReadyForAutoSend
 * (למעלה) — תנאי משלו, *לא* importersDb.needsCompletion (זה מניע רק את תג התצוגה
 * בדשבורד; צמצום התג ב-2026-07-31 לא אמור לצמצם את השער — ראו הבהרת משתמש שם).
 * importer=null/undefined (לא הועבר) נחשב "לא זכאי" גם הוא (importerReadyForAutoSend
 * מטפל בכך).
 */
function autoSendEnabled(route, dept, shipmentRec, importer) {
  const mode = autoSendModeForDept(dept);
  if (mode === 'off') return false;
  if (!TRANSFER_ROUTES.has(route)) return false;
  if (!automation.isEligible(shipmentRec)) return false; // חסימה קבועה — לעולם לא על תיקים ישנים/לא-ודאיים
  if (!VERIFIED_COLOADER_RULES.has(shipmentRec?.gatepass_co_loader_rule)) return false; // קוד לא אומת מול ה-PDF
  if (!importerReadyForAutoSend(importer)) return false; // יבואן לא זכאי (אין מוביל המשך שנפתר / haifa_self בלי מייל)
  return graph.isEnabled();
}

/**
 * Task 4/6 — שליחה או דחייה של מייל העברה לחיפה.
 * הרשומה חייבת להתקיים ב-DB לפני החיפוש (gatepass.setGatepass מבצע UPDATE).
 * מדיניות (Task 4): לא שולחים בלי ה-gatepass PDF — משאירים awaiting_gatepass, וניסיון
 * חוזר בקומיט הבא. שליחה נעשית עם ה-PDF כצרופה אמיתית; הנמענים כבר עברו override במסווג.
 *
 * dry_run (תוספת אוטומציה, נפרדת/ניתנת-להסרה): כשהמצב הוא dry_run, מריצים את כל
 * הבדיקה (כולל gatepass) אך *לא* קוראים ל-graph.sendMail ו*לא* מסמנים נשלח — התיק
 * נשאר בתור הרגיל לטיפול אנושי. נרשם ל-dry_run_log כסימולציה מלאה (נמענים/גוף/PDF).
 *
 * מחזיר 'auto_sent' | 'dry_run' | 'awaiting_gatepass' | 'error'.
 */
async function sendOrDefer(fileNumber, email, summary, dept) {
  const mode = autoSendModeForDept(dept);
  let res;
  try {
    res = await gatepass.fetchForFile(fileNumber); // { path } בהצלחה, אחרת { skipped }
  } catch (e) {
    summary.errors += 1;
    return 'error';
  }
  if (!res || !res.path) {
    summary.awaiting_gatepass += 1;
    return 'awaiting_gatepass'; // ממתין ל-PDF — יישאר גלוי ויינסה שוב בקומיט הבא
  }
  const outgoing = { ...email, attachments: [res.path] };

  if (mode === 'dry_run') {
    // סימולציה מלאה — Graph.sendMail לעולם לא נקרא כאן, ואין markSent.
    const shipped = shipments.get(fileNumber);
    shipments.logDryRun({
      file_number: fileNumber, customer_name: shipped?.customer_name, route: shipped?.route,
      email: outgoing, wouldAttachGatepass: true,
    });
    summary.dry_run = (summary.dry_run || 0) + 1;
    return 'dry_run';
  }

  try {
    // צירוף ה-gatepass כ-fileAttachment אמיתי (graphMail תומך במערך נתיבים)
    await graph.sendMail(outgoing);
  } catch (e) {
    summary.errors += 1;
    return 'error'; // נשאר awaiting_gatepass — ניסיון חוזר בקומיט הבא
  }
  // לוג "מיילים שנשלחו" — העתק היסטורי מדויק כפי שנשלח (append-only)
  const shipped = shipments.get(fileNumber);
  shipments.logSentEmail({ file_number: fileNumber, customer_name: shipped?.customer_name, route: shipped?.route, email: outgoing, auto: true });
  shipments.markSent(fileNumber, 'נשלח אוטומטית (העברה לחיפה) עם gatepass', { auto: true });
  summary.auto_sent += 1;
  return 'auto_sent';
}

// ---------- תוויות עברית קצרות לסיבות alert — לצורך הערת סיווג-מחדש (Task 4) בלבד.
// לא כפילות מכוונת של status.ts בצד הלקוח (needsAttentionReason) — שם/הקשר שונים
// (טקסט UI לדשבורד מול הערת audit-trail ב-status_history), אין קשר תחזוקתי ביניהם.
const ALERT_REASON_LABEL = {
  unknown_co_loader: 'קוד קו-לואדר לא מזוהה',
  unknown_terminal: 'מסוף שחרור לא מזוהה',
  terminal_requires_co_loader: 'מסוף מחייב קו-לואדר',
  unknown_customer: 'לקוח לא מזוהה',
};

/**
 * reclassifyNote — בונה הערת audit-trail עברית לתיק שסווג מחדש (Task 4). לא נכתבת
 * ל-status_history כשורה נפרדת — מוזנת כ-notes של אותה שורת שינוי-סטטוס שכבר נכתבת
 * ע"י upsert() בתוך buildAndMaybeSendDraft (ראו הערה בקריאה למטה), כדי למנוע כפל
 * שורות היסטוריה לאותו מעבר.
 */
function reclassifyNote(prevReason, decision) {
  const prevLabel = ALERT_REASON_LABEL[prevReason] || 'התראה';
  let trigger = '';
  if (decision.route === 'co_loader' && decision.handler?.code) {
    trigger = ` — קוד קו-לואדר ${decision.handler.code} נמצא במערכת`;
  } else if (decision.route === 'terminal' && decision.handler?.site) {
    trigger = ` — מסוף "${decision.handler.site}" נמצא במערכת`;
  }
  return `סיווג מחדש: התיק היה חסום (${prevLabel}) ועבר למסלול ${decision.route}${trigger}`;
}

/**
 * buildAndMaybeSendDraft — Task 2: "בניית טיוטת העברה לחיפה + שליחה אוטומטית אם
 * זכאי" — משותף לנתיב תיק-חדש ולנתיב סיווג-מחדש (תיק שהיה alert ונפתר), כדי שלוגיקת
 * ה-branching (isHaifaTransfer / dry_run / autoSendEnabled / preloadedGatepass) לא
 * תשוכפל בשני מקומות עצמאיים שעלולים לסטות זה מזה. preloadedGatepass מועבר כפרמטר
 * (לא נסגר עליו מהיקף מודול) כי הוא closure פר-מחזור-קומיט שמוגדר בתוך commit() עצמה
 * (cache עצל של הודעות gatepass לכל מחזור).
 * מחזירה את הרשומה השמורה (savedRec).
 */
async function buildAndMaybeSendDraft(rec, decision, importer, dept, perf, performerUnknown, base, summary, preloadedGatepass) {
  // האם התיק הוא "העברה לחיפה" אמיתית (LCL + מסלול co_loader/terminal/direct +
  // מסוף שאינו הנמל עצמו)? רק אז בונים טיוטה. אחרת (prepaid / FCL / שחרור בנמל
  // עצמו) — נספר בדשבורד כ"שוחרר באשדוד" בלבד, ללא טיוטה וללא מייל (החלטת משתמש
  // 2026-07-13). prepaid לעולם אינו מקבל מייל.
  if (!isHaifaTransfer(rec, decision)) {
    const savedRec = shipments.upsert({ ...base, status: STATUS.RELEASED });
    summary.tracked_released += 1;
    return savedRec;
  }

  // מסלול העברה לחיפה — בניית טיוטה (חסימת השליחה בלי gatepass PDF נאכפת באישור)
  const email = composeRelease(rec, decision, importer);
  const withDraft = {
    ...base,
    draft_payload: { route: decision.route, needs_review: !!decision.needs_review, email, alerts: decision.alerts || [] },
  };

  // חתך-גיל האוטומציה (Task 1, תוספת per-department): נכתב תמיד ל-DB *לפני* בדיקת
  // הזכאות לאוטומציה, כדי ש-first_seen יהיה קיים ברשומה בזמן הבדיקה (תיק חדש
  // שנוצר באותו מחזור קומיט חייב first_seen אמיתי — לא ניתן להעריך חתך-גיל בלעדיו).
  // ברירת מחדל: AWAITING_PDF (המסלול הרגיל) — משודרג בהמשך אם אוטומציה זכאית.
  const savedRec = shipments.upsert({ ...withDraft, status: STATUS.AWAITING_PDF });

  // Task 6 — שליחה אוטומטית רק למסלולי ההעברה לחיפה (co_loader/terminal), מאחורי
  // מצב-מחלקה + חתך-גיל (auto_send_excluded + epoch, services/automation.js).
  // dry_run (תוספת אוטומציה): מריצים את כל הבדיקה/סימולציה, אך התיק *נשאר* בנתיב
  // הרגיל (AWAITING_PDF -> pending_approval) — לא עובר ל-AWAITING_GATEPASS, כדי
  // שלא ייצא מתור האישורים הרגיל וימתין לטיפול אנושי כרגיל.
  if (autoSendModeForDept(dept) === 'dry_run' && autoSendEnabled(decision.route, dept, savedRec, importer)) {
    await sendOrDefer(rec.file_number, email, summary, dept); // רושם סימולציה ל-dry_run_log בלבד
    const preload = await preloadedGatepass(rec.file_number);
    if (preload && preload.path) summary.pdf_preloaded += 1;
    else summary.awaiting_pdf += 1;
  } else if (autoSendEnabled(decision.route, dept, savedRec, importer)) {
    // הרשומה כבר קיימת (upsert למעלה) — נדרש לפני חיפוש ה-gatepass (setGatepass מבצע UPDATE)
    shipments.upsert({ file_number: rec.file_number, status: STATUS.AWAITING_GATEPASS });
    await sendOrDefer(rec.file_number, email, summary, dept);
  } else {
    // הטיוטה נבנית מיד, אך מוחזקת מחוץ לתור האישורים עד שיצורף gatepass PDF
    // (אוטומטית ב-gatepassFetcher או ידנית מכרטיס התיק). setGatepass יעביר אז
    // אוטומטית ל-pending_approval. עד אז — נראית רק בדשבורד/כרטיס, ללא שליחה.
    // Task 1 (2026-07-14) — בדיקה מקדימה מיידית: אם ה-PDF כבר יושב בתיבה, התיק
    // עובר ל-pending_approval באותו מחזור קומיט (attachFromMessages/setGatepass
    // מבצעים את המעבר). אם לא נמצא — נשאר "ממתין ל-PDF" כרגיל.
    const preload = await preloadedGatepass(rec.file_number);
    if (preload && preload.path) {
      summary.pdf_preloaded += 1;
      // תיקון race מקורו-בעבר (הבאג "שני קליקים"): כשה-autoSendEnabled הראשון
      // (למעלה) נבדק, gatepass_co_loader_rule עדיין לא היה קיים (הקוד טרם אומת
      // מול PDF) ולכן נכשל תמיד על תיק חדש — גם אם ה-PDF זמין באותה רגע. עכשיו,
      // אחרי ש-preloadedGatepass מצא PDF וקרא ל-resolveCoLoaderFromPdf (דרך
      // attachFromMessages/setGatepass), הקוד כבר אומת ורשומת ה-DB עודכנה —
      // נטענים אותה מחדש ונבדקת הזכאות פעם נוספת, באותו מחזור קומיט, כדי שהמייל
      // ייצא מיד ולא ימתין למחזור/קליק הבא. אם עדיין לא זכאי — נשאר pending_approval
      // כרגיל, ללא שינוי התנהגות.
      const refreshed = shipments.get(rec.file_number);
      if (refreshed && refreshed.status === 'pending_approval'
        && autoSendEnabled(decision.route, dept, refreshed, importer)) {
        // עדיפות ל-draft_payload.email העדכני על פני ה-email המקומי שהורכב למעלה:
        // אם resolveCoLoaderFromPdf זיהה קוד קו-לואדר שונה (rule='adopt') הוא כבר
        // חידש את הטיוטה ב-DB (gatepassCoLoaderHook.js) — שולחים את הגרסה המאומתת,
        // לא עותק ישן שהורכב לפני שהקוד אומת מול ה-PDF בפועל.
        let toSend = email;
        try {
          const payload = refreshed.draft_payload ? JSON.parse(refreshed.draft_payload) : null;
          if (payload?.email) toSend = payload.email;
        } catch { /* נשאר עם ה-email המקומי */ }
        // sendOrDefer עצמו מכבד dry_run (רושם ל-dry_run_log בלבד, לא שולח/מסמן נשלח) —
        // אותה פונקציה בדיוק כמו בענפים off-cycle/AWAITING_GATEPASS למעלה.
        await sendOrDefer(rec.file_number, toSend, summary, dept);
      }
    } else {
      summary.awaiting_pdf += 1;
    }
  }
  return savedRec;
}

// ---------- Task 2: קומיט — סיווג + כתיבה ל-DB + טיוטה/שליחה ----------
async function commit() {
  // Task 1: קליטת עריכות config.json/terminals.json שנעשו ידנית בזמן שהשרת רץ, בלי
  // restart — בודק mtime ומפרסר מחדש רק אם השתנה. נקרא כאן (פעם אחת למחזור קומיט),
  // לא בתוך לולאת הרשומות, כדי לא לבצע stat() מיותר לכל רשומה.
  configModule.refreshIfChanged();
  if (!config.feature_flags?.ashdod_release) return record({ skipped: 'feature_off', at: new Date().toISOString() });

  // אם אין סריקה עדיין / הסריקה נכשלה / התיישנה — סורקים כעת (inline) לפני הקומיט.
  if (scanCacheStale()) scanOnce();
  if (scanCache.error === 'report_missing') {
    return record({ skipped: 'report_missing', path: REPORT_PATH, at: new Date().toISOString() });
  }

  const records = scanCache.records || [];
  const summary = {
    total: records.length, out_of_scope: 0, no_op: 0, queued: 0, awaiting_pdf: 0, pdf_preloaded: 0, alerts: 0,
    tracked_released: 0, skipped_tracked: 0, auto_sent: 0, dry_run: 0, awaiting_gatepass: 0, errors: 0,
    importers_created: 0, re_classified: 0, outcome_changed: 0,
  };

  // סריקה מקדימה של הודעות ה-gatepass (Task 1, 2026-07-14): נשלפת פעם אחת, עצלנית —
  // רק בפעם הראשונה שנדרשת בקומיט הזה — כדי שקובץ חדש שה-PDF שלו כבר יושב בתיבה יעבור
  // ל-pending_approval באותו מחזור, ולא ימתין למחזור ה-poller הנפרד (gatepassFetcher).
  let gatepassMessages; // undefined = טרם נשלף במחזור הזה; null = לא זמין (Graph כבוי/כשל)
  async function preloadedGatepass(fileNumber) {
    if (gatepassMessages === undefined) {
      if (!graph.isEnabled()) {
        gatepassMessages = null;
      } else {
        try { gatepassMessages = await gatepass.fetchGatepassMessages(); }
        catch (e) { gatepassMessages = null; }
      }
    }
    if (!gatepassMessages) return null;
    try { return await gatepass.attachFromMessages(fileNumber, gatepassMessages); }
    catch (e) { return null; }
  }

  for (const rec of records) {
    try {
      // כלל scope קבוע — LCL + רשימת ההעברה לחיפה נכנסים לצנרת (כל שלוש המחלקות)
      if (!inScope(rec)) { summary.out_of_scope += 1; continue; }

      let importer = importersDb.findByName(rec.customer_name);
      // יבואן לא מוכר (לא מדויק ולא alias) — יוצרים רשומה אוטומטית (Task 2), במחלקה
      // שנגזרת מ-service_rep, כדי שהתיק לעולם לא ייעלם מאחורי department:null וכדי
      // שיהיה מקום מיידי להשלים אליו מיילים/אנשי-קשר. type:'unknown' עד השלמה ידנית —
      // needsCompletion (db/importers.js) יסמן זאת בדשבורד. לא רץ על no_op (לא רלוונטי
      // לאשדוד כלל) — נבדק לפני היצירה כדי לא ליצור יבואנים סרק לרשומות לא-אשדוד.
      if (!importer && rec.customs_station_code === String(config.relevant_customs_station_code) && rec.customer_name) {
        const { importer: ensured, created } = importersDb.ensureImporter(rec.customer_name, {
          department: repToDept(rec.service_rep) || '', service_rep: rec.service_rep || '',
        });
        importer = ensured;
        if (created) {
          summary.importers_created += 1;
          console.log(`[reportWatcher] יבואן חדש נוצר אוטומטית: "${rec.customer_name}" (תיק ${rec.file_number}, מחלקה ${importer.department || '—'})`);
        }
      }
      const decision = classify(rec, importer);

      if (decision.route === 'no_op') { summary.no_op += 1; continue; } // לא נשמר

      // Task 8 — "מבצע העברה לחיפה" ואם הוא ישות מוכרת ב-co_loaders/terminals
      const perf = transferPerformer(rec);
      const performerUnknown = perf && !contacts.isKnown(perf) ? 1 : 0;
      const dept = departmentFor(rec, importer);

      const existing = shipments.get(rec.file_number);
      if (existing) {
        // תיק שממתין ל-gatepass — ניסיון שליחה חוזר (לא "כבר טופל")
        const existingDept = existing.department || dept;
        if (existing.status === STATUS.AWAITING_GATEPASS && autoSendEnabled(decision.route, existingDept, existing, importer)) {
          const email = composeRelease(rec, decision, importer);
          await sendOrDefer(rec.file_number, email, summary, existingDept);
          continue;
        }
        // הערכה חוזרת חד-פעמית, CUS1 בלבד (2026-07-30, אישור משתמש מפורש): תיקי CUS1
        // שכבר יושבים ב-pending_approval (נבנו לפני שהאוטומציה חלה עליהם/שוחררו ידנית
        // מ-auto_send_excluded) לא היו עוברים דרך ה-retry הרגיל, שמוגבל ל-AWAITING_GATEPASS
        // בלבד — לכן תיק ששוחרר מ-release-cus1-ready.js לא היה נשלח אוטומטית לעולם.
        // מכוון במפורש למחלקת cus1 בקוד (לא existingDept דינמי) כדי שלא יתרחב בטעות
        // למחלקה אחרת אם מצב האוטומציה שלה ישונה בעתיד. ניתן להסרה נקייה — לא נוגע
        // בגייט הכללי (autoSendEnabled) ולא במסלול ה-AWAITING_GATEPASS למעלה.
        if (existing.status === 'pending_approval' && existingDept === 'cus1' && autoSendEnabled(decision.route, existingDept, existing, importer)) {
          const email = composeRelease(rec, decision, importer);
          await sendOrDefer(rec.file_number, email, summary, existingDept);
          continue;
        }

        // Task 2 — סיווג מחדש: תיק שהיה תקוע ב-alert (למשל קוד קו-לואדר/מסוף/לקוח לא
        // מזוהים) מסווג מחדש בכל מחזור קומיט נגד הדוח/config העדכניים ביותר. מוגבל
        // במפורש ל-status === 'alert' בלבד — לא מורחב ל-AWAITING_PDF/awaiting_gatepass/
        // pending_approval, שכבר יש להם מנגנוני retry משלהם (הענפים למעלה) ואינם
        // "חסומים" באותו מובן. הגנת-משנה מפורשת: תיק ששולם/נשלח (ownsFile) לעולם לא
        // נוגעים בו — לא אמור להיות ישים בפועל לתיק ב-alert, אך נשמר כהגנת-עומק
        // (למשל אם owns_file_statuses ייערך ידנית בעתיד לכלול alert בטעות).
        if (existing.status === STATUS.ALERT && !shipments.ownsFile(rec.file_number)) {
          summary.re_classified += 1;
          const outcomeChanged = decision.route !== 'alert';
          if (!outcomeChanged) {
            // התוצאה עדיין alert — רק מרעננים תוכן (סיבה/release_date/department) בלי
            // לגעת בסטטוס, כדי לא לגרום לכתיבת שורת היסטוריה מיותרת (upsert כותב
            // היסטוריה רק כשמפתח status מועבר ושונה מהקיים — לכן לא כולל status כאן).
            const patch = {};
            if (rec.release_date && !existing.release_date) patch.release_date = rec.release_date;
            if (!existing.department && dept) patch.department = dept;
            if (!existing.agent_name && importer?.service_rep) patch.agent_name = importer.service_rep;
            if (decision.reason && decision.reason !== existing.reason) patch.reason = decision.reason;
            if (Object.keys(patch).length) shipments.upsert({ file_number: rec.file_number, ...patch });
            summary.skipped_tracked += 1; continue;
          }
          // התוצאה השתנתה — נפתר למסלול אמיתי (prepaid/co_loader/terminal/direct).
          // בונים מחדש את base ומריצים את אותה לוגיקת בניית-טיוטה/שליחה-אוטומטית
          // המשותפת לנתיב תיק-חדש (buildAndMaybeSendDraft) — ללא שכפול לוגיקה.
          summary.outcome_changed += 1;
          const base = {
            file_number: rec.file_number,
            customer_name: rec.customer_name,
            route: decision.route,
            reason: decision.reason || null,
            release_date: rec.release_date || null,
            department: dept,
            co_loader_code: rec.co_loader_code || null,
            continuation: decision.continuation?.name || null,
            transfer_performer: perf || null,
            performer_unknown: performerUnknown,
            site_des: rec.site_des || null,
            fcl_lcl: rec.fcl_lcl || null,
            hazardous: rec.hazardous,
            wg_reshimon_no: rec.wg_reshimon_no || null,
            type: importer?.type || null,
            agent_name: importer?.service_rep || rec.service_rep || null,
            // Task 4 — הערת audit-trail: נכתבת לתוך אותה שורת status_history שכבר
            // נוצרת בתוך buildAndMaybeSendDraft (upsert כותב notes לשורת ההיסטוריה
            // בעת שינוי status) — לא קריאת addHistory נפרדת, כדי למנוע כפל שורות.
            notes: reclassifyNote(existing.reason, decision),
          };
          // isHaifaTransfer/prepaid/FCL וכו' — כל ההסתעפות מטופלת בתוך buildAndMaybeSendDraft
          // עצמה (זהה בדיוק לנתיב תיק-חדש, כולל "שוחרר באשדוד" ללא טיוטה כשלא רלוונטי).
          await buildAndMaybeSendDraft(rec, decision, importer, dept, perf, performerUnknown, base, summary, preloadedGatepass);
          // Task 3 — שחרור נקודתי מחתך-הגיל: רק עכשיו, אחרי שההחלטה על שליחה למחזור
          // הזה כבר התקבלה (autoSendEnabled בתוך buildAndMaybeSendDraft נבדקה מול
          // auto_send_excluded הישן) — כך שהשחרור בפועל חל רק מהמחזור הבא ואילך,
          // ולא יכול לגרום לשליחה אוטומטית "באותו מחזור" שהתיק נפתר. מוגבל למסלולי
          // האוטומציה הצרים בפועל (co_loader/terminal בלבד — TRANSFER_ROUTES המקומי
          // כאן, לא HAIFA_TRANSFER_ROUTES הרחב יותר של המסווג שכולל גם direct).
          if (TRANSFER_ROUTES.has(decision.route)) {
            shipments.clearAutoSendExclusion(rec.file_number);
            console.log(`[reportWatcher] תיק ${rec.file_number} שוחרר מחתך-גיל האוטומציה (סיווג מחדש: alert -> ${decision.route})`);
          }
          continue;
        }

        // תיק קיים אחר — משלימים release_date מהדוח אם חסר, ורוענן department אם היה
        // חסר ועכשיו ניתן לגזור (למשל יבואן שמופה מאוחר יותר — ראו departmentFor).
        // לא נוגעים בסטטוס/היסטוריה, ולא דורסים department קיים בערך אחר.
        const patch = {};
        if (rec.release_date && !existing.release_date) patch.release_date = rec.release_date;
        if (!existing.department && dept) patch.department = dept;
        if (!existing.agent_name && importer?.service_rep) patch.agent_name = importer.service_rep;
        if (Object.keys(patch).length) shipments.upsert({ file_number: rec.file_number, ...patch });
        summary.skipped_tracked += 1; continue; // כבר טופל/שוחרר
      }

      if (decision.route === 'alert') {
        shipments.upsert({
          file_number: rec.file_number,
          customer_name: rec.customer_name,
          status: STATUS.ALERT,
          route: 'alert',
          reason: decision.reason,
          release_date: rec.release_date || null,
          department: dept,
          transfer_performer: perf || null,
          performer_unknown: performerUnknown,
          site_des: rec.site_des || null,
          fcl_lcl: rec.fcl_lcl || null,
          hazardous: rec.hazardous,
          draft_payload: { decision },
        });
        summary.alerts += 1;
        continue;
      }

      // שדות המעקב המשותפים — נשמרים לכל תיק אשדוד לתצוגה בדשבורד, בין אם מקבל
      // טיוטה ובין אם נספר בלבד. draft_payload מתווסף רק לתיקי ההעברה לחיפה האמיתיים.
      const base = {
        file_number: rec.file_number,
        customer_name: rec.customer_name,
        route: decision.route,
        reason: decision.reason || null,
        release_date: rec.release_date || null,
        department: dept,
        co_loader_code: rec.co_loader_code || null,
        continuation: decision.continuation?.name || null,
        transfer_performer: perf || null,
        performer_unknown: performerUnknown,
        site_des: rec.site_des || null,
        fcl_lcl: rec.fcl_lcl || null,
        hazardous: rec.hazardous,
        wg_reshimon_no: rec.wg_reshimon_no || null,
        type: importer?.type || null,
        agent_name: importer?.service_rep || rec.service_rep || null,
      };

      // בניית טיוטה/שליחה אוטומטית — משותף עם נתיב סיווג-מחדש (ראו buildAndMaybeSendDraft).
      await buildAndMaybeSendDraft(rec, decision, importer, dept, perf, performerUnknown, base, summary, preloadedGatepass);
    } catch (e) {
      summary.errors += 1;
    }
  }

  return record({ ...summary, scannedAt: scanCache.scannedAt, at: new Date().toISOString() });
}

function record(r) {
  lastRun = r;
  return r;
}

/**
 * מיגרציה חד-פעמית: תיקי pending_approval ישנים של מסלול העברה לחיפה שאין להם עדיין
 * gatepass PDF (מהמודל הישן, לפני החזקת הטיוטה במצב "ממתין ל-PDF") מועברים למצב החדש,
 * כדי שלא יופיעו בתור האישורים בלי PDF. תזכורות (draft_payload.reminder) אינן מושפעות.
 * אידמפוטנטי — אחרי ריצה ראשונה אין עוד תיקים כאלה.
 */
function migrateAwaitingPdf() {
  let moved = 0;
  for (const r of shipments.byStatus(STATUS.PENDING)) {
    if (r.gatepass_pdf_path) continue;
    if (!requiresGatepass(r.route)) continue;
    let payload = null;
    try { payload = r.draft_payload ? JSON.parse(r.draft_payload) : null; } catch { /* ignore */ }
    if (payload && payload.reminder) continue; // תזכורת אינה דורשת gatepass
    shipments.upsert({ file_number: r.file_number, status: STATUS.AWAITING_PDF, notes: r.notes });
    moved += 1;
  }
  if (moved) console.log(`[reportWatcher] מיגרציה: ${moved} טיוטות ללא PDF הועברו ל"${STATUS.AWAITING_PDF}"`);
  return moved;
}

// ---------- הרצה ידנית (manual): סריקה + קומיט מיידיים, עוקף את שני השעונים ----------
async function runNow() {
  migrateAwaitingPdf();
  scanOnce();
  return commit();
}

// ---------- תזמון ----------
let scanTimer = null;
let commitTimer = null;
let lastRun = null;
let nextCommitAt = null;

/**
 * מרחק בזמן (ms) עד ה-HH:MM הבא של הקומיט, מיושר לשעון-קיר מקומי.
 * targetMin = 60 - commit_before_hour_minutes (למשל 55). מחושב תמיד מ-now אמיתי כדי
 * להישאר מיושר גם לאחר restart / דריפט / מעבר שעון קיץ.
 */
function msUntilNextCommit(now = new Date()) {
  const beforeMin = Number(config.commit_before_hour_minutes ?? 5);
  const targetMin = ((60 - beforeMin) % 60 + 60) % 60;
  const t = new Date(now);
  t.setSeconds(0, 0);
  t.setMinutes(targetMin);
  if (t.getTime() <= now.getTime()) t.setHours(t.getHours() + 1); // עברנו את היעד — לשעה הבאה
  return t.getTime() - now.getTime();
}

function scheduleNextCommit() {
  const delay = msUntilNextCommit();
  nextCommitAt = new Date(Date.now() + delay).toISOString();
  commitTimer = setTimeout(async () => {
    try { await commit(); } catch (e) { record({ error: e.message, at: new Date().toISOString() }); }
    scheduleNextCommit(); // רה-תזמון מ-now טרי — שומר יישור לשעון הקיר
  }, delay);
}

function start() {
  if (scanTimer || commitTimer) return;
  migrateAwaitingPdf();                // מיגרציה חד-פעמית של טיוטות ישנות ללא PDF
  const scanMs = (config.poll_interval_minutes || 10) * 60 * 1000;
  scanOnce();                          // סריקה ראשונית מיידית
  scanTimer = setInterval(scanOnce, scanMs);
  scheduleNextCommit();                // קומיט ראשון ב-HH:55 הקרוב
}

function stop() {
  if (scanTimer) clearInterval(scanTimer);
  if (commitTimer) clearTimeout(commitTimer);
  scanTimer = commitTimer = null;
}

function status() {
  return {
    last: lastRun,
    scan: scanCache ? { scannedAt: scanCache.scannedAt, count: scanCache.count ?? (scanCache.records || []).length, error: scanCache.error } : null,
    nextCommitAt,
    automation: automation.getState(),
  };
}

module.exports = {
  // ליבה
  scanOnce, commit, runNow, migrateAwaitingPdf,
  runOnce: runNow, // תאימות לאחור (reset-shipments / endpoint ידני) — הרצה מלאה מיידית
  // תזמון
  start, stop, status,
  // אוטומציה — off/dry_run/on (מצב לכל מחלקה, ראו services/automation.js)
  autoSendModeForDept, autoSendEnabled, sendOrDefer, importerReadyForAutoSend,
  // חשוף לבדיקות
  inScope, msUntilNextCommit, departmentFor,
};
