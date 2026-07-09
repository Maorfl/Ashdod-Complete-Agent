/**
 * services/dailyReport.js — דוח מחלקתי פעמיים ביום (New Task 3).
 *
 * פעמיים ביום, ב-09:00 וב-15:00 (מיושר לשעון קיר, אותה טכניקת setTimeout
 * self-rescheduling כמו pdfCleanup ב-retention וקומיט ה-HH:55 ב-reportWatcher —
 * מחשבים delay מ-now טרי, לא setInterval שצובר drift):
 *
 * לכל מחלקה (cus1/cus2/cus3) נאסף רשימת התיקים בסטטוס 'יצא לחיפה' שהסטטוס עודכן
 * לפני 2+ ימים, ונשלח מייל נפרד — מ-ashdod.agent@h-caspi.co.il אל כתובת המחלקה
 * עצמה בלבד (cus1@/cus2@/cus3@h-caspi.co.il) — עם טבלת HTML של תיקי אותה מחלקה.
 *
 * ⚠️ שליחה אוטומטית אמיתית (לא מאחורי אישור אנושי) — זהו דוח פנימי לכתובות פנימיות
 * בלבד. אינו עובר במסווג ולכן external_email_override (שחל רק על נמענים חיצוניים
 * במסווג) אינו רלוונטי כאן. כל שליחה נרשמת ללוג (מחלקה, נמען, מספר תיקים, זמן).
 * מאחורי דגל config.feature_flags.daily_report — ניתן לכבות בלי שינוי קוד.
 */
const { config } = require('../config');
const shipments = require('../db/shipments');
const graph = require('./graphMail');

const TRANSIT_STATUS = 'יצא לחיפה';
const AGE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_HOURS = [9, 15]; // 09:00 ו-15:00, אישור משתמש

const DEPTS = ['cus1', 'cus2', 'cus3'];

function isEnabled() {
  return config.feature_flags?.daily_report !== false;
}

// תאריך ISO (yyyy-mm-dd) -> dd/mm/yy, עקבי עם formatDateHe בקליינט
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}

// משך בסטטוס בעברית — אותו רעיון כמו formatDuration/hoursSince בקליינט (צד שרת)
function ageText(iso) {
  if (!iso) return '—';
  const h = (Date.now() - Date.parse(iso)) / 3600000;
  if (!isFinite(h)) return '—';
  if (h < 24) return `${Math.floor(h)} שע'`;
  return `${Math.floor(h / 24)} ימים`;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// אוסף את התיקים ב'יצא לחיפה' 2+ ימים, מקובצים לפי מחלקה (רק המחלקות המוכרות)
function collectStale(now = Date.now()) {
  const cutoff = now - AGE_DAYS * DAY_MS;
  const byDept = { cus1: [], cus2: [], cus3: [] };
  for (const s of shipments.byStatus(TRANSIT_STATUS)) {
    if (!s.status_updated_at || Date.parse(s.status_updated_at) >= cutoff) continue;
    if (byDept[s.department]) byDept[s.department].push(s);
  }
  return byDept;
}

// בונה את מייל הדוח למחלקה בודדת (from/to/subject/bodyHtml) — ללא שליחה
function buildDeptEmail(dept, list) {
  const to = config.departments?.[dept]?.email;
  const deptName = config.departments?.[dept]?.name || dept.toUpperCase();
  const rows = list.map((s) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace;">${esc(s.file_number)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;">${esc(s.customer_name || '—')}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace;">${fmtDate(s.release_date)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;">${esc(s.transfer_performer || '—')}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;">${ageText(s.status_updated_at)}</td>
      </tr>`).join('');

  const bodyHtml = `<div style="font-family:Arial;font-size:12pt;direction:rtl;text-align:right;">
    <p>שלום ${esc(deptName)},</p>
    <p>להלן ${list.length} תיקים בסטטוס "${TRANSIT_STATUS}" מעל ${AGE_DAYS} ימים — נא לבדוק ולעדכן סטטוס.</p>
    <table style="border-collapse:collapse;font-size:11pt;">
      <thead>
        <tr style="background:#f2f4f7;">
          <th style="padding:6px 10px;border:1px solid #ddd;">מספר תיק</th>
          <th style="padding:6px 10px;border:1px solid #ddd;">שם לקוח</th>
          <th style="padding:6px 10px;border:1px solid #ddd;">תאריך שחרור</th>
          <th style="padding:6px 10px;border:1px solid #ddd;">מבצע העברה לחיפה</th>
          <th style="padding:6px 10px;border:1px solid #ddd;">זמן ב"${TRANSIT_STATUS}"</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
    <p style="color:#667;font-size:10pt;">דוח אוטומטי — סוכן כספי אשדוד. נשלח פעמיים ביום (09:00, 15:00).</p>
  </div>`;

  return {
    from: config.sender_mailbox,
    to: to ? [to] : [],
    cc: [],
    subject: `דוח יומי — ${list.length} תיקים ב"${TRANSIT_STATUS}" ${AGE_DAYS}+ ימים (${dept.toUpperCase()})`,
    bodyHtml,
  };
}

// מריץ את הדוח: שולח מייל נפרד לכל מחלקה עם תיקים. מחזיר סיכום, ורושם ללוג.
async function runReport() {
  if (!isEnabled()) {
    console.log('[dailyReport] הדגל daily_report כבוי — דילוג');
    return { skipped: 'feature_off', at: new Date().toISOString() };
  }
  const byDept = collectStale();
  const results = [];
  for (const dept of DEPTS) {
    const list = byDept[dept] || [];
    if (!list.length) continue;
    const email = buildDeptEmail(dept, list);
    if (!email.to.length) {
      console.warn(`[dailyReport] אין כתובת מייל למחלקה ${dept} — דילוג (${list.length} תיקים)`);
      continue;
    }
    try {
      await graph.sendMail(email);
      console.log(`[dailyReport] נשלח דוח ל-${dept} (${email.to[0]}) — ${list.length} תיקים ב"${TRANSIT_STATUS}" ${AGE_DAYS}+ ימים`);
      results.push({ dept, to: email.to[0], count: list.length, ok: true });
    } catch (e) {
      console.error(`[dailyReport] כשל שליחה ל-${dept} (${email.to[0]}): ${e.message}`);
      results.push({ dept, to: email.to[0], count: list.length, ok: false, error: e.message });
    }
  }
  if (!results.length) console.log(`[dailyReport] אין תיקים העונים לקריטריון ("${TRANSIT_STATUS}" ${AGE_DAYS}+ ימים) — לא נשלחו דוחות`);
  const summary = { sent: results.filter((r) => r.ok).length, results, at: new Date().toISOString() };
  lastRun = summary;
  return summary;
}

// ---------- תזמון ----------
let timer = null;
let lastRun = null;
let nextRunAt = null;

// ms עד ה-09:00/15:00 הקרוב, מחושב תמיד מ-now אמיתי (יישור לשעון קיר)
function msUntilNextRun(now = new Date()) {
  let best = Infinity;
  for (const h of RUN_HOURS) {
    const t = new Date(now);
    t.setHours(h, 0, 0, 0);
    if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
    best = Math.min(best, t.getTime() - now.getTime());
  }
  return best;
}

function schedule() {
  const delay = msUntilNextRun();
  nextRunAt = new Date(Date.now() + delay).toISOString();
  timer = setTimeout(async () => {
    try { await runReport(); } catch (e) { console.error('[dailyReport]', e.message); }
    schedule(); // רה-תזמון מ-now טרי — שומר יישור ל-09:00/15:00
  }, delay);
}

function start() {
  if (timer) return;
  schedule();
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function status() {
  return { last: lastRun, nextRunAt, enabled: isEnabled() };
}

module.exports = {
  start, stop, status, runReport,
  // חשוף לבדיקות
  collectStale, buildDeptEmail, msUntilNextRun, isEnabled,
};
