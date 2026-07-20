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
const { config, REPORT_PATH } = require('../config');
const { readReport } = require('../report/reader');
const { classify, transferPerformer, isHaifaTransfer, requiresGatepass } = require('../report/classifier');
const { composeRelease } = require('../email/composer');
const importersDb = require('../db/importers');
const shipments = require('../db/shipments');
const graph = require('./graphMail');
const gatepass = require('./gatepassFetcher');
const scope = require('../scope');
const contacts = require('../db/contacts');

// pending_approval — תור אישור אנושי; awaiting_gatepass — מסלול העברה שאושר לשליחה
// אוטומטית וממתין להגעת ה-gatepass PDF (Task 4/6). alert — בדיקה ידנית.
const STATUS = { ALERT: 'alert', PENDING: 'pending_approval', AWAITING_GATEPASS: 'awaiting_gatepass', RELEASED: 'שוחרר באשדוד', AWAITING_PDF: shipments.AWAITING_PDF_STATUS };
const TRANSFER_ROUTES = new Set(['co_loader', 'terminal']);

// כלל scope קבוע (config.report_scope): רק LCL + הנציג הנבחר + רשימת לקוחות ההעברה
// לחיפה (Task 3) נכנסים לצנרת. תחנת מכס 2 נאכפת בנפרד ע"י כלל ה-no_op במסווג.
function normRep(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function inScope(rec) {
  const s = config.report_scope || {};
  // (2026-07-13, אישור משתמש) גם תיקי FCL של אשדוד נכנסים למעקב לתצוגה בדשבורד —
  // ה-fcl_lcl כבר אינו מסנן החוצה. הוא קובע רק זכאות *טיוטה* (isHaifaTransfer דורש LCL).
  // אשדוד-בלבד (תחנת מכס 2) נאכף ע"י כלל ה-no_op במסווג; FCL מסלולי ההעברה נספרים בלבד.
  if (s.service_rep && normRep(rec.service_rep) !== normRep(s.service_rep)) return false;
  // רק 19 לקוחות ההעברה לחיפה — מקור אמת יחיד ב-scope.js (משותף לשכבת ההגשה)
  if (!scope.isWhitelisted(rec.customer_name)) return false;
  return true;
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

// האם מסלול זה זכאי לשליחה אוטומטית? (Task 6: co_loader/terminal + דגל + Graph מחובר)
function autoSendEnabled(route) {
  return !!config.feature_flags?.auto_send_haifa_transfer && TRANSFER_ROUTES.has(route) && graph.isEnabled();
}

/**
 * Task 4/6 — שליחה או דחייה של מייל העברה לחיפה.
 * הרשומה חייבת להתקיים ב-DB לפני החיפוש (gatepass.setGatepass מבצע UPDATE).
 * מדיניות (Task 4): לא שולחים בלי ה-gatepass PDF — משאירים awaiting_gatepass, וניסיון
 * חוזר בקומיט הבא. שליחה נעשית עם ה-PDF כצרופה אמיתית; הנמענים כבר עברו override במסווג.
 * מחזיר 'auto_sent' | 'awaiting_gatepass' | 'error'.
 */
async function sendOrDefer(fileNumber, email, summary) {
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

// ---------- Task 2: קומיט — סיווג + כתיבה ל-DB + טיוטה/שליחה ----------
async function commit() {
  if (!config.feature_flags?.ashdod_release) return record({ skipped: 'feature_off', at: new Date().toISOString() });

  // אם אין סריקה עדיין / הסריקה נכשלה / התיישנה — סורקים כעת (inline) לפני הקומיט.
  if (scanCacheStale()) scanOnce();
  if (scanCache.error === 'report_missing') {
    return record({ skipped: 'report_missing', path: REPORT_PATH, at: new Date().toISOString() });
  }

  const records = scanCache.records || [];
  const summary = {
    total: records.length, out_of_scope: 0, no_op: 0, queued: 0, awaiting_pdf: 0, pdf_preloaded: 0, alerts: 0,
    tracked_released: 0, skipped_tracked: 0, auto_sent: 0, awaiting_gatepass: 0, errors: 0,
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
      // כלל scope קבוע — רק LCL + הנציג + רשימת ההעברה לחיפה נכנסים לצנרת
      if (!inScope(rec)) { summary.out_of_scope += 1; continue; }

      const importer = importersDb.findByName(rec.customer_name);
      const decision = classify(rec, importer);

      if (decision.route === 'no_op') { summary.no_op += 1; continue; } // לא נשמר

      // Task 8 — "מבצע העברה לחיפה" ואם הוא ישות מוכרת ב-co_loaders/terminals
      const perf = transferPerformer(rec);
      const performerUnknown = perf && !contacts.isKnown(perf) ? 1 : 0;

      const existing = shipments.get(rec.file_number);
      if (existing) {
        // תיק שממתין ל-gatepass — ניסיון שליחה חוזר (לא "כבר טופל")
        if (existing.status === STATUS.AWAITING_GATEPASS && autoSendEnabled(decision.route)) {
          const email = composeRelease(rec, decision, importer);
          await sendOrDefer(rec.file_number, email, summary);
          continue;
        }
        // תיק קיים אחר — משלימים release_date מהדוח אם חסר (לא נוגעים בסטטוס/היסטוריה)
        if (rec.release_date && !existing.release_date) {
          shipments.upsert({ file_number: rec.file_number, release_date: rec.release_date });
        }
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
          department: importer?.department || null,
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
        department: importer?.department || null,
        co_loader_code: rec.co_loader_code || null,
        continuation: decision.continuation?.name || null,
        transfer_performer: perf || null,
        performer_unknown: performerUnknown,
        site_des: rec.site_des || null,
        fcl_lcl: rec.fcl_lcl || null,
        hazardous: rec.hazardous,
        wg_reshimon_no: rec.wg_reshimon_no || null,
        type: importer?.type || null,
        agent_name: importer?.service_rep || null,
      };

      // האם התיק הוא "העברה לחיפה" אמיתית (LCL + מסלול co_loader/terminal/direct +
      // מסוף שאינו הנמל עצמו)? רק אז בונים טיוטה. אחרת (prepaid / FCL / שחרור בנמל
      // עצמו) — נספר בדשבורד כ"שוחרר באשדוד" בלבד, ללא טיוטה וללא מייל (החלטת משתמש
      // 2026-07-13). prepaid לעולם אינו מקבל מייל.
      if (!isHaifaTransfer(rec, decision)) {
        shipments.upsert({ ...base, status: STATUS.RELEASED });
        summary.tracked_released += 1;
        continue;
      }

      // מסלול העברה לחיפה — בניית טיוטה (חסימת השליחה בלי gatepass PDF נאכפת באישור)
      const email = composeRelease(rec, decision, importer);
      const withDraft = {
        ...base,
        draft_payload: { route: decision.route, needs_review: !!decision.needs_review, email, alerts: decision.alerts || [] },
      };

      // Task 6 — שליחה אוטומטית רק למסלולי ההעברה לחיפה (co_loader/terminal), מאחורי דגל.
      if (autoSendEnabled(decision.route)) {
        // הרשומה חייבת להתקיים לפני חיפוש ה-gatepass (setGatepass מבצע UPDATE)
        shipments.upsert({ ...withDraft, status: STATUS.AWAITING_GATEPASS });
        await sendOrDefer(rec.file_number, email, summary);
      } else {
        // הטיוטה נבנית מיד, אך מוחזקת מחוץ לתור האישורים עד שיצורף gatepass PDF
        // (אוטומטית ב-gatepassFetcher או ידנית מכרטיס התיק). setGatepass יעביר אז
        // אוטומטית ל-pending_approval. עד אז — נראית רק בדשבורד/כרטיס, ללא שליחה.
        shipments.upsert({ ...withDraft, status: STATUS.AWAITING_PDF });
        // Task 1 (2026-07-14) — בדיקה מקדימה מיידית: אם ה-PDF כבר יושב בתיבה, התיק
        // עובר ל-pending_approval באותו מחזור קומיט (attachFromMessages/setGatepass
        // מבצעים את המעבר). אם לא נמצא — נשאר "ממתין ל-PDF" כרגיל.
        const preload = await preloadedGatepass(rec.file_number);
        if (preload && preload.path) summary.pdf_preloaded += 1;
        else summary.awaiting_pdf += 1;
      }
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
  };
}

module.exports = {
  // ליבה
  scanOnce, commit, runNow, migrateAwaitingPdf,
  runOnce: runNow, // תאימות לאחור (reset-shipments / endpoint ידני) — הרצה מלאה מיידית
  // תזמון
  start, stop, status,
  // חשוף לבדיקות
  inScope, msUntilNextCommit,
};
