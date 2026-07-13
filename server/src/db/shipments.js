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
`);

// עמודות עבודה של הסוכן — מתווספות רק אם חסרות (לא הרסני)
const AGENT_COLUMNS = {
  route: 'TEXT',
  reason: 'TEXT',
  department: 'TEXT',
  co_loader_code: 'TEXT',
  continuation: 'TEXT',
  hazardous: 'TEXT',
  wg_reshimon_no: 'TEXT',
  type: 'TEXT',
  draft_payload: 'TEXT',
  agent_sent_at: 'DATETIME',
  first_seen: 'DATETIME',
  last_seen: 'DATETIME',
  gatepass_pdf_path: 'TEXT', // נתיב מקומי ל-PDF שהתקבל מ-do-not-reply עבור התיק (Task 6)
  auto_sent: 'INTEGER',      // 1 = נשלח אוטומטית (העברה לחיפה) ללא אישור אנושי (Task 6)
  transfer_performer: 'TEXT', // "מבצע העברה לחיפה" — קו-לואדר / משלח לא-כספי / מסוף (classifier.transferPerformer)
  performer_unknown: 'INTEGER', // 1 = מבצע ההעברה אינו ישות מוכרת ב-co_loaders/terminals (Task 8)
  site_des: 'TEXT', // מסוף השחרור (Cust. Stor. Site Des) — קובע את יעד ההגעה בחיפה (haifa_arrival)
  fcl_lcl: 'TEXT', // FCL/LCL מהדוח — נספר לתצוגה בדשבורד; רק LCL זכאי להעברה לחיפה
};
(function ensureAgentColumns() {
  const existing = new Set(db.prepare('PRAGMA table_info(shipments)').all().map((c) => c.name));
  for (const [col, type] of Object.entries(AGENT_COLUMNS)) {
    if (!existing.has(col)) db.exec(`ALTER TABLE shipments ADD COLUMN ${col} ${type}`);
  }
})();

const OWNS_STATUSES = new Set(config.tracking?.owns_file_statuses || ['sent']);
const SENT_STATUS = config.tracking?.sent_status || 'sent';
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
  if (!rec || !OWNS_STATUSES.has(rec.status)) return null;
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
    wg_reshimon_no: rec.wg_reshimon_no ?? existing?.wg_reshimon_no ?? null,
    type: rec.type ?? existing?.type ?? null,
    draft_payload: rec.draft_payload !== undefined ? (rec.draft_payload ? JSON.stringify(rec.draft_payload) : null) : existing?.draft_payload ?? null,
    agent_sent_at: rec.agent_sent_at ?? existing?.agent_sent_at ?? null,
    first_seen: existing?.first_seen ?? now,
    last_seen: now,
  };

  db.prepare(`INSERT INTO shipments
    (file_number,customer_name,release_date,status,status_updated_at,notes,created_at,agent_name,
     route,reason,department,co_loader_code,continuation,transfer_performer,performer_unknown,site_des,fcl_lcl,hazardous,wg_reshimon_no,type,draft_payload,agent_sent_at,first_seen,last_seen)
    VALUES (@file_number,@customer_name,@release_date,@status,@status_updated_at,@notes,@created_at,@agent_name,
     @route,@reason,@department,@co_loader_code,@continuation,@transfer_performer,@performer_unknown,@site_des,@fcl_lcl,@hazardous,@wg_reshimon_no,@type,@draft_payload,@agent_sent_at,@first_seen,@last_seen)
    ON CONFLICT(file_number) DO UPDATE SET
      customer_name=@customer_name,release_date=@release_date,status=@status,status_updated_at=@status_updated_at,
      notes=@notes,agent_name=@agent_name,route=@route,reason=@reason,department=@department,
      co_loader_code=@co_loader_code,continuation=@continuation,transfer_performer=@transfer_performer,
      performer_unknown=@performer_unknown,site_des=@site_des,fcl_lcl=@fcl_lcl,hazardous=@hazardous,wg_reshimon_no=@wg_reshimon_no,
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
    .run(SENT_STATUS, now, now, now, opts.auto ? 1 : 0, String(fileNumber));
  addHistory(fileNumber, SENT_STATUS, notes);
  return get(fileNumber);
}

// שמירת נתיב ה-PDF שהתקבל עבור התיק (gatepass מ-do-not-reply / העלאה ידנית) — Task 6.
// נקודת המעבר היחידה לתור האישורים: אם התיק היה במצב "ממתין ל-PDF", צירוף ה-PDF
// מעביר אותו אוטומטית ל-pending_approval (אטומי, כולל רישום היסטוריה).
function setGatepass(fileNumber, pdfPath) {
  db.prepare('UPDATE shipments SET gatepass_pdf_path=? WHERE file_number=?')
    .run(pdfPath || null, String(fileNumber));
  const rec = get(fileNumber);
  if (pdfPath && rec && rec.status === AWAITING_PDF_STATUS) {
    return setStatus(fileNumber, 'pending_approval', 'gatepass התקבל — הועבר לאישור שליחה');
  }
  return rec;
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
  addHistory,
  remove,
  logSentEmail,
  sentEmails,
  all,
  byStatus,
  history,
  statusChangesSince,
  counts,
  SENT_STATUS,
  AWAITING_PDF_STATUS,
};
