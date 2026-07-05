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
};
(function ensureAgentColumns() {
  const existing = new Set(db.prepare('PRAGMA table_info(shipments)').all().map((c) => c.name));
  for (const [col, type] of Object.entries(AGENT_COLUMNS)) {
    if (!existing.has(col)) db.exec(`ALTER TABLE shipments ADD COLUMN ${col} ${type}`);
  }
})();

const OWNS_STATUSES = new Set(config.tracking?.owns_file_statuses || ['sent']);
const SENT_STATUS = config.tracking?.sent_status || 'sent';

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
     route,reason,department,co_loader_code,continuation,hazardous,wg_reshimon_no,type,draft_payload,agent_sent_at,first_seen,last_seen)
    VALUES (@file_number,@customer_name,@release_date,@status,@status_updated_at,@notes,@created_at,@agent_name,
     @route,@reason,@department,@co_loader_code,@continuation,@hazardous,@wg_reshimon_no,@type,@draft_payload,@agent_sent_at,@first_seen,@last_seen)
    ON CONFLICT(file_number) DO UPDATE SET
      customer_name=@customer_name,release_date=@release_date,status=@status,status_updated_at=@status_updated_at,
      notes=@notes,agent_name=@agent_name,route=@route,reason=@reason,department=@department,
      co_loader_code=@co_loader_code,continuation=@continuation,hazardous=@hazardous,wg_reshimon_no=@wg_reshimon_no,
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

// סימון "נשלח" — מקור האמת ל-ownsFile
function markSent(fileNumber, notes = null) {
  const now = new Date().toISOString();
  db.prepare('UPDATE shipments SET status=?, status_updated_at=?, agent_sent_at=?, last_seen=? WHERE file_number=?')
    .run(SENT_STATUS, now, now, now, String(fileNumber));
  addHistory(fileNumber, SENT_STATUS, notes);
  return get(fileNumber);
}

// שמירת נתיב ה-PDF שהתקבל עבור התיק (gatepass מ-do-not-reply) — Task 6
function setGatepass(fileNumber, pdfPath) {
  db.prepare('UPDATE shipments SET gatepass_pdf_path=? WHERE file_number=?')
    .run(pdfPath || null, String(fileNumber));
  return get(fileNumber);
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
  all,
  byStatus,
  history,
  counts,
  SENT_STATUS,
};
