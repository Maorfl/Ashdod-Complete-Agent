/**
 * db/shipments.js — מעקב תיקים. מקור האמת ל-ownsFile.
 *
 * משתמש בטבלאות הקיימות ב-data/shipments.db (shipments + status_history) בדיוק
 * לפי האפיון, ולא יוצר טבלאות מקבילות. עמודות עבודה של הסוכן מתווספות
 * בצורה לא-הרסנית (ALTER TABLE ADD COLUMN רק אם חסר) כדי לשמר נתונים קיימים.
 *
 * SQLite במצב WAL — מאפשר קריאות במקביל מכמה מחשבים ברשת.
 */
const path = require('path');
const Database = require('better-sqlite3');
const { DATA_DIR, config } = require('../config');

const db = new Database(path.join(DATA_DIR, 'shipments.db'));
db.pragma('journal_mode = WAL');

// סכימת בסיס — נוצרת רק אם ה-DB ריק (CREATE IF NOT EXISTS לא נוגע בנתונים קיימים)
db.exec(`
CREATE TABLE IF NOT EXISTS shipments (
  file_number TEXT PRIMARY KEY,
  customer_name TEXT,
  release_date DATE,
  status TEXT,
  status_updated_at DATETIME,
  notes TEXT,
  created_at DATETIME,
  agent_name TEXT
);
CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_number TEXT,
  status TEXT,
  changed_at DATETIME,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS sent_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_number TEXT,
  customer_name TEXT,
  route TEXT,
  from_address TEXT,
  to_addresses TEXT,
  cc_addresses TEXT,
  subject TEXT,
  body TEXT,
  auto INTEGER,
  sent_at DATETIME
);
CREATE TABLE IF NOT EXISTS dry_run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_number TEXT,
  customer_name TEXT,
  route TEXT,
  from_address TEXT,
  to_addresses TEXT,
  cc_addresses TEXT,
  subject TEXT,
  body TEXT,
  would_attach_gatepass INTEGER,
  simulated_at DATETIME
);
`);

// עמודות עבודה של הסוכן — מתווספות רק אם חסרות (לא הרסני)
const AGENT_COLUMNS = {
  route: 'TEXT',
  reason: 'TEXT',
  department: 'TEXT',
  co_loader_code: 'TEXT',
  continuation: 'TEXT',
  hazardous: 'TEXT',
  commodity: 'TEXT', // ערך גולמי של עמודת Commodity מהדוח (Task 1) — נשמר בנפרד מ-hazardous (הדגל האפקטיבי) לביקורת
  customer_reference: 'TEXT', // Customer Reference מהדוח — מספר הזמנת הלקוח, נכנס לנושא מייל ההעברה
  wg_reshimon_no: 'TEXT',
  type: 'TEXT',
  draft_payload: 'TEXT',
  agent_sent_at: 'DATETIME',
  first_seen: 'DATETIME',
  last_seen: 'DATETIME',
  gatepass_pdf_path: 'TEXT', // נתיב מקומי ל-PDF שהתקבל מ-do-not-reply עבור התיק (Task 6)
  gatepass_source: 'TEXT', // 'mail' | 'upload' — מקור ה-PDF שצורף (Task 6, פרובננס)
  auto_sent: 'INTEGER',      // 1 = נשלח אוטומטית (העברה לחיפה) ללא אישור אנושי (Task 6)
  transfer_performer: 'TEXT', // "מבצע העברה לחיפה" — קו-לואדר / משלח לא-כספי / מסוף (classifier.transferPerformer)
  performer_unknown: 'INTEGER', // 1 = מבצע ההעברה אינו ישות מוכרת ב-co_loaders/terminals (Task 8)
  site_des: 'TEXT', // מסוף השחרור (Cust. Stor. Site Des) — קובע את יעד ההגעה בחיפה (haifa_arrival)
  fcl_lcl: 'TEXT', // FCL/LCL מהדוח — נספר לתצוגה בדשבורד; רק LCL זכאי להעברה לחיפה
  auto_send_excluded: 'INTEGER', // 1 = חסום קבוע מאוטומציה (חתך גיל אוטומציה — ראו migrateAutoSendExclusion)
  gatepass_deal_id: 'TEXT', // מזהה עסקה בן 16 תווים שחולץ מעמוד "תעודת משלוח" ב-PDF (services/gatepassParser)
  gatepass_co_loader_code: 'TEXT', // תווים 11-13 של gatepass_deal_id — קוד קו-לואדר לפי ה-PDF (לא לפי הדוח)
  gatepass_co_loader_rule: 'TEXT', // איזה כלל החלטה (Task 2) קבע את הניתוב: match/adopt/terminal/mismatch_hold/extraction_failed
  gatepass_parsed_at: 'DATETIME', // מתי חולץ (cache — לא מפרסרים מחדש כל פעם שה-PDF כבר קיים ונותח)
};
(function ensureAgentColumns() {
  const existing = new Set(db.prepare('PRAGMA table_info(shipments)').all().map((c) => c.name));
  for (const [col, type] of Object.entries(AGENT_COLUMNS)) {
    if (!existing.has(col)) db.exec(`ALTER TABLE shipments ADD COLUMN ${col} ${type}`);
  }
})();

/**
 * migrateAutoSendExclusion — חד-פעמי, אידמפוטנטי: מסמן קבוע auto_send_excluded=1 על
 * כל תיק שכבר קיים ב-DB *ברגע הקריאה הראשונה* לאחר הוספת מנגנון האוטומציה per-department
 * (חתך גיל, Task 1). תיקים חדשים (auto_send_excluded IS NULL כברירת מחדל) אינם מסומנים.
 *
 * אידמפוטנטיות: לאחר הריצה הראשונה, לתיקים הישנים auto_send_excluded=1 (לא NULL עוד).
 * תיקים חדשים שנכנסים מאותו רגע ואילך נשארים NULL (=לא מסומן) גם בהרצות חוזרות —
 * WHERE auto_send_excluded IS NULL בלבד, כך שתיק "חדש" לעולם לא נתפס בטעות אם הפונקציה
 * נקראת שוב (למשל restart נוסף לפני שהאפיצ'ה קראה ל-markEpochNow).
 *
 * הקריאה בפועל (מתי "עכשיו" זה) אחראית עליה שכבת האוטומציה (services/automation.js):
 * בפעם הראשונה שנקבע epoch (data/automation.json חסר) — קוראים לכאן ואז קובעים epoch.
 * מחזיר את מספר השורות שסומנו (לצורך לוג/דיווח).
 */
function migrateAutoSendExclusion() {
  const res = db.prepare('UPDATE shipments SET auto_send_excluded = 1 WHERE auto_send_excluded IS NULL').run();
  return res.changes;
}

/**
 * clearAutoSendExclusion — שחרור חד-פעמי וממוקד של תיק בודד מחתך-הגיל (Task 2/3,
 * reportWatcher.js): נקרא רק כשתיק שהיה תקוע ב-alert נפתר בסיווג מחדש למסלול
 * co_loader/terminal אמיתי. לא נוגע בתיקים אחרים — שחרור נקודתי, לא גורף. שער
 * האוטומציה (automation.isEligible) הוא רק תנאי אחד מני רבים ב-autoSendEnabled;
 * שחרור הדגל אינו עוקף שום תנאי שער אחר (מחלקה/Graph/gatepass/יבואן).
 */
function clearAutoSendExclusion(fileNumber) {
  db.prepare('UPDATE shipments SET auto_send_excluded = 0 WHERE file_number = ?').run(String(fileNumber));
  return get(fileNumber);
}

// פונקציות ולא consts קבועים (Task 1, סנכרון חי): config.tracking עשוי להשתנות בזמן
// ריצה (config.js מרענן לפי mtime) — נגזרות בכל קריאה, לא נשמרות ב-cache מודול.
function ownsStatuses() { return new Set(config.tracking?.owns_file_statuses || ['sent']); }
function sentStatus() { return config.tracking?.sent_status || 'sent'; }
// טיוטת העברה לחיפה מוכנה אך ממתינה ל-gatepass PDF — מוחזקת מחוץ לתור האישורים עד
// שה-PDF מצורף (אוטומטית או ידנית). מקור אמת יחיד למחרוזת הסטטוס.
const AWAITING_PDF_STATUS = 'ממתין ל-PDF';

function get(fileNumber) {
  return db.prepare('SELECT * FROM shipments WHERE file_number = ?').get(String(fileNumber));
}

function isTracked(fileNumber) {
  return !!get(fileNumber);
}

/**
 * ownsFile — מחזיר רשומה רק אם התיק כבר טופל/נשלח (status ∈ owns_file_statuses).
 * מטרתו למנוע שליחה כפולה: אם הסוכן כבר שלח, או שהתיק כבר שוחרר/נמסר ידנית — לא שולחים שוב.
 */
function ownsFile(fileNumber) {
  const rec = get(fileNumber);
  if (!rec || !ownsStatuses().has(rec.status)) return null;
  return rec;
}

// רישום שורת היסטוריה
function addHistory(fileNumber, status, notes = null) {
  db.prepare(
    'INSERT INTO status_history (file_number, status, changed_at, notes) VALUES (?, ?, ?, ?)'
  ).run(String(fileNumber), status, new Date().toISOString(), notes);
}

/**
 * upsert — יוצר/מעדכן תיק. שומר על first_seen, מעדכן last_seen.
 * מעדכן status_history רק כשהסטטוס באמת משתנה.
 */
function upsert(rec) {
  const now = new Date().toISOString();
  const existing = get(rec.file_number);
  const merged = {
    file_number: String(rec.file_number),
    customer_name: rec.customer_name ?? existing?.customer_name ?? null,
    release_date: rec.release_date ?? existing?.release_date ?? null,
    status: rec.status ?? existing?.status ?? null,
    status_updated_at: rec.status !== undefined && rec.status !== existing?.status ? now : existing?.status_updated_at ?? null,
    notes: rec.notes ?? existing?.notes ?? null,
    created_at: existing?.created_at ?? now,
    agent_name: rec.agent_name ?? existing?.agent_name ?? null,
    route: rec.route ?? existing?.route ?? null,
    reason: rec.reason ?? existing?.reason ?? null,
    department: rec.department ?? existing?.department ?? null,
    co_loader_code: rec.co_loader_code ?? existing?.co_loader_code ?? null,
    continuation: rec.continuation ?? existing?.continuation ?? null,
    transfer_performer: rec.transfer_performer ?? existing?.transfer_performer ?? null,
    performer_unknown: rec.performer_unknown ?? existing?.performer_unknown ?? 0,
    site_des: rec.site_des ?? existing?.site_des ?? null,
    fcl_lcl: rec.fcl_lcl ?? existing?.fcl_lcl ?? null,
    hazardous: rec.hazardous ?? existing?.hazardous ?? null,
    commodity: rec.commodity ?? existing?.commodity ?? null,
    customer_reference: rec.customer_reference ?? existing?.customer_reference ?? null,
    wg_reshimon_no: rec.wg_reshimon_no ?? existing?.wg_reshimon_no ?? null,
    type: rec.type ?? existing?.type ?? null,
    draft_payload: rec.draft_payload !== undefined ? (rec.draft_payload ? JSON.stringify(rec.draft_payload) : null) : existing?.draft_payload ?? null,
    agent_sent_at: rec.agent_sent_at ?? existing?.agent_sent_at ?? null,
    first_seen: existing?.first_seen ?? now,
    last_seen: now,
  };

  db.prepare(`INSERT INTO shipments
    (file_number,customer_name,release_date,status,status_updated_at,notes,created_at,agent_name,
     route,reason,department,co_loader_code,continuation,transfer_performer,performer_unknown,site_des,fcl_lcl,hazardous,commodity,customer_reference,wg_reshimon_no,type,draft_payload,agent_sent_at,first_seen,last_seen)
    VALUES (@file_number,@customer_name,@release_date,@status,@status_updated_at,@notes,@created_at,@agent_name,
     @route,@reason,@department,@co_loader_code,@continuation,@transfer_performer,@performer_unknown,@site_des,@fcl_lcl,@hazardous,@commodity,@customer_reference,@wg_reshimon_no,@type,@draft_payload,@agent_sent_at,@first_seen,@last_seen)
    ON CONFLICT(file_number) DO UPDATE SET
      customer_name=@customer_name,release_date=@release_date,status=@status,status_updated_at=@status_updated_at,
      notes=@notes,agent_name=@agent_name,route=@route,reason=@reason,department=@department,
      co_loader_code=@co_loader_code,continuation=@continuation,transfer_performer=@transfer_performer,
      performer_unknown=@performer_unknown,site_des=@site_des,fcl_lcl=@fcl_lcl,hazardous=@hazardous,commodity=@commodity,customer_reference=@customer_reference,wg_reshimon_no=@wg_reshimon_no,
      type=@type,draft_payload=@draft_payload,agent_sent_at=@agent_sent_at,last_seen=@last_seen`).run(merged);

  if (rec.status !== undefined && rec.status !== existing?.status) {
    addHistory(merged.file_number, merged.status, rec.notes ?? null);
  }
  return get(rec.file_number);
}

// עדכון סטטוס בלבד + רישום היסטוריה
function setStatus(fileNumber, status, notes = null) {
  const now = new Date().toISOString();
  db.prepare('UPDATE shipments SET status=?, status_updated_at=?, last_seen=? WHERE file_number=?')
    .run(status, now, now, String(fileNumber));
  addHistory(fileNumber, status, notes);
  return get(fileNumber);
}

// סימון "נשלח" — מקור האמת ל-ownsFile. opts.auto=true => שליחה אוטומטית (Task 6).
function markSent(fileNumber, notes = null, opts = {}) {
  const now = new Date().toISOString();
  db.prepare('UPDATE shipments SET status=?, status_updated_at=?, agent_sent_at=?, last_seen=?, auto_sent=? WHERE file_number=?')
    .run(sentStatus(), now, now, now, opts.auto ? 1 : 0, String(fileNumber));
  addHistory(fileNumber, sentStatus(), notes);
  return get(fileNumber);
}

// שמירת נתיב ה-PDF שהתקבל עבור התיק (gatepass מ-do-not-reply / העלאה ידנית) — Task 6.
// נקודת המעבר היחידה לתור האישורים: אם התיק היה במצב "ממתין ל-PDF", צירוף ה-PDF
// מעביר אותו אוטומטית ל-pending_approval (אטומי, כולל רישום היסטוריה).
// source: 'mail' | 'upload' — מקור ה-PDF (Task 6, מקור/פרובננס); אופציונלי (undefined
// לא דורס ערך קיים) כדי שקריאות ישנות/פנימיות ללא source לא ינקו את השדה בטעות.
function setGatepass(fileNumber, pdfPath, source) {
  if (!pdfPath) {
    // ניקוי הנתיב מנקה גם את המקור — לא משאירים gatepass_source ישן ליד path=null
    db.prepare('UPDATE shipments SET gatepass_pdf_path=NULL, gatepass_source=NULL WHERE file_number=?')
      .run(String(fileNumber));
  } else if (source !== undefined) {
    db.prepare('UPDATE shipments SET gatepass_pdf_path=?, gatepass_source=? WHERE file_number=?')
      .run(pdfPath, source || null, String(fileNumber));
  } else {
    // קריאה ישנה/פנימית ללא source: לא דורסים מקור קיים (nullable, ברירת המחדל
    // הבטוחה כשלא ידוע מי קרא) — משאירים gatepass_source כפי שהוא.
    db.prepare('UPDATE shipments SET gatepass_pdf_path=? WHERE file_number=?')
      .run(pdfPath, String(fileNumber));
  }
  const rec = get(fileNumber);
  if (pdfPath && rec && rec.status === AWAITING_PDF_STATUS) {
    return setStatus(fileNumber, 'pending_approval', 'gatepass התקבל — הועבר לאישור שליחה');
  }
  return rec;
}

/**
 * שמירת תוצאת חילוץ הקוד מה-PDF (services/gatepassParser) — cache כך שה-PDF לא
 * מפורש מחדש בכל מחזור קומיט. rule = 'match'|'adopt'|'terminal'|'mismatch_hold'|
 * 'extraction_failed' (Task 2, reportWatcher). dealId/coLoaderCode עשויים להיות null
 * כשהחילוץ נכשל (rule='extraction_failed') — עדיין נשמר כדי לא לנסות שוב על אותו PDF.
 */
function setGatepassParseResult(fileNumber, { dealId, coLoaderCode, rule }) {
  db.prepare('UPDATE shipments SET gatepass_deal_id=?, gatepass_co_loader_code=?, gatepass_co_loader_rule=?, gatepass_parsed_at=? WHERE file_number=?')
    .run(dealId || null, coLoaderCode || null, rule || null, new Date().toISOString(), String(fileNumber));
  return get(fileNumber);
}

/**
 * sent_emails — לוג append-only של מיילים שנשלחו בפועל (לא נגזר מ-draft_payload,
 * שעלול להידרס בעריכה/recompose). נכתב בכל הצלחה של graphMail.sendMail — גם במסלול
 * האישור האנושי (routes/approvals) וגם בשליחה האוטומטית (reportWatcher.sendOrDefer).
 */
function logSentEmail({ file_number, customer_name, route, email, auto = false }) {
  db.prepare(`INSERT INTO sent_emails
    (file_number, customer_name, route, from_address, to_addresses, cc_addresses, subject, body, auto, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    String(file_number || ''), customer_name || null, route || null,
    email?.from || null,
    JSON.stringify(email?.to || []), JSON.stringify(email?.cc || []),
    email?.subject || null, email?.body || null,
    auto ? 1 : 0, new Date().toISOString(),
  );
}

function sentEmails(limit = 200) {
  return db.prepare('SELECT * FROM sent_emails ORDER BY sent_at DESC, id DESC LIMIT ?').all(limit);
}

/**
 * dry_run_log — לוג נפרד (append-only) של "מה היה נשלח" במצב dry_run (Task 2, תוספת
 * אוטומציה). לא נוגע ב-sent_emails/markSent — הטיוטה נשארת בתור האישורים הרגיל.
 * טבלה נפרדת בכוונה כדי שהמנגנון יהיה ניתן להסרה נקייה בלי לגעת בשליחה האמיתית.
 */
function logDryRun({ file_number, customer_name, route, email, wouldAttachGatepass = false }) {
  db.prepare(`INSERT INTO dry_run_log
    (file_number, customer_name, route, from_address, to_addresses, cc_addresses, subject, body, would_attach_gatepass, simulated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    String(file_number || ''), customer_name || null, route || null,
    email?.from || null,
    JSON.stringify(email?.to || []), JSON.stringify(email?.cc || []),
    email?.subject || null, email?.body || null,
    wouldAttachGatepass ? 1 : 0, new Date().toISOString(),
  );
}

function dryRunLog(limit = 200) {
  return db.prepare('SELECT * FROM dry_run_log ORDER BY simulated_at DESC, id DESC LIMIT ?').all(limit);
}

// מחיקת תיק מהמעקב + היסטוריית הסטטוסים שלו (טרנזקציה). לניקוי רשומות שלא היו
// אמורות להיכנס לצנרת (out-of-scope). מחזיר מספר שורות shipments שנמחקו (0/1).
const _remove = db.transaction((fileNumber) => {
  db.prepare('DELETE FROM status_history WHERE file_number = ?').run(String(fileNumber));
  return db.prepare('DELETE FROM shipments WHERE file_number = ?').run(String(fileNumber)).changes;
});
function remove(fileNumber) {
  return _remove(fileNumber);
}

function all() {
  return db.prepare('SELECT * FROM shipments ORDER BY COALESCE(last_seen, status_updated_at, created_at) DESC').all();
}

function byStatus(status) {
  return db.prepare('SELECT * FROM shipments WHERE status = ? ORDER BY status_updated_at DESC').all(status);
}

// Task 6 — לצורך אזהרת מחיקה בעמוד "ניהול מסופים ומשלחים": כל התיקים המשויכים
// לקוד קו-לואדר / מסוף נתון (כולל סגורים — הסינון ל"פעילים בלבד" נעשה בצד הקורא).
function byCoLoaderCode(code) {
  return db.prepare('SELECT * FROM shipments WHERE co_loader_code = ?').all(String(code));
}
function bySiteDes(siteDes) {
  return db.prepare('SELECT * FROM shipments WHERE site_des = ?').all(String(siteDes));
}

function history(fileNumber) {
  return db.prepare('SELECT * FROM status_history WHERE file_number = ? ORDER BY changed_at ASC').all(String(fileNumber));
}

// כל שינויי הסטטוס מאז זמן ISO נתון (לספירת "שינויי סטטוס היום" בדוח היומי)
function statusChangesSince(sinceIso) {
  return db.prepare('SELECT file_number, status, changed_at FROM status_history WHERE changed_at >= ? ORDER BY changed_at ASC').all(String(sinceIso));
}

// ספירות לדשבורד (5 מונים)
function counts() {
  const rows = db.prepare('SELECT status, COUNT(*) n FROM shipments GROUP BY status').all();
  const byStat = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return {
    total: rows.reduce((s, r) => s + r.n, 0),
    by_status: byStat,
  };
}

module.exports = {
  db,
  get,
  isTracked,
  ownsFile,
  upsert,
  setStatus,
  markSent,
  setGatepass,
  setGatepassParseResult,
  addHistory,
  remove,
  logSentEmail,
  sentEmails,
  logDryRun,
  dryRunLog,
  all,
  byStatus,
  byCoLoaderCode,
  bySiteDes,
  history,
  statusChangesSince,
  counts,
  migrateAutoSendExclusion,
  clearAutoSendExclusion,
  sentStatus,
  ownsStatuses,
  AWAITING_PDF_STATUS,
};
