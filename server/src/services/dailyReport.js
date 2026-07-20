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
// כתובת כניסה לדשבורד — מוצגת ככפתור בתחתית סיכום ה-15:00 (New Task 3, 2026-07-15)
const DASHBOARD_URL = 'http://192.168.15.75:4000/';

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

// תאריך מלא dd/mm/yyyy — לכותרת סיכום המונים (עקבי בפורמט עם fmtDate, אך עם שנה מלאה)
function fmtFullDate(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

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

// ---------- סיכום מונים יומי (15:00 בלבד) ----------
// מסלולי ההעברה לחיפה — לספירת "העברות לחיפה היום" (עקבי עם classifier.HAIFA_TRANSFER_ROUTES)
const HAIFA_TRANSFER_ROUTES = new Set(['co_loader', 'terminal', 'direct']);
// "פעיל בדשבורד" = כל תיק שטרם נמסר ללקוח (עקבי עם statusKeyOf בקליינט, שמסתיר 'delivered'
// מברירת המחדל "הכל"). מוצג ברצועה הכהה בתחתית הדוח (New Task 4, 2026-07-14).
const DELIVERED_STATUS = 'נמסר ללקוח';

// תחילת היום המקומי כ-timestamp (ms) — "היום" לצורך הספירות
function startOfToday(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * collectCounts — לכל מחלקה, מוני היום:
 *   released       — תיקים שנצפו לראשונה היום (כל תיק שמור הוא אשדוד/תחנת מכס 2)
 *   transfers      — מתוכם, תיקי מסלול העברה לחיפה (co_loader/terminal/direct)
 *   statusChanges  — שינויי סטטוס היום (status_history) לתיקי המחלקה
 *   attention      — תיקים ב"יצא לחיפה" 2+ ימים (טבלת ההזדקנות, אותה לוגיקה כמו collectStale)
 *   activeTotal    — סה"כ תיקים פעילים כרגע בדשבורד (לא נמסרו) עבור המחלקה (New Task 4)
 */
function collectCounts(now = Date.now()) {
  const start = startOfToday(now);
  const byDept = {};
  for (const d of DEPTS) byDept[d] = { released: 0, transfers: 0, statusChanges: 0, attention: 0, activeTotal: 0 };

  for (const s of shipments.all()) {
    if (!byDept[s.department]) continue;
    if (s.status !== DELIVERED_STATUS) byDept[s.department].activeTotal += 1;
    if (s.first_seen && Date.parse(s.first_seen) >= start) {
      byDept[s.department].released += 1;
      if (HAIFA_TRANSFER_ROUTES.has(s.route)) byDept[s.department].transfers += 1;
    }
  }

  for (const h of shipments.statusChangesSince(new Date(start).toISOString())) {
    const rec = shipments.get(h.file_number);
    if (rec && byDept[rec.department]) byDept[rec.department].statusChanges += 1;
  }

  const stale = collectStale(now);
  for (const d of DEPTS) byDept[d].attention = (stale[d] || []).length;
  return byDept;
}

// עיצוב ג׳ (New Task 4, 2026-07-14, אישור משתמש) — HTML מבוסס טבלאות (תאימות לתוכנות
// מייל, לא flex/grid) עם צבעי hex קבועים (אין תמיכה ב-CSS variables/dark-mode במייל):
//   כותרת כחול-כהה (#0F2A3F) עם כותרת לבנה + שורת תאריך/שעה בהירה,
//   רשת 2×2 של אריחי מונים צבעוניים, ורצועה כהה בתחתית עם "סה״כ תיקים פעילים
//   בדשבורד" — המספר בפונט בהיר (#ffffff) על הרקע הכהה כדי שיהיה קריא (הערת משתמש).
const TILE = (bg, fg, n, label) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:8px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-family:'Courier New',Courier,monospace;font-size:26px;font-weight:800;color:${fg};line-height:1;">${n}</div>
          <div style="font-size:12px;color:${fg};margin-top:6px;font-weight:600;">${esc(label)}</div>
        </td></tr>
      </table>`;

// בונה את מייל סיכום המונים למחלקה בודדת (נשלח תמיד, גם כשכל המונים 0)
function buildCountsEmail(dept, c) {
  const to = config.departments?.[dept]?.email;
  const deptName = config.departments?.[dept]?.name || dept.toUpperCase();
  const dateStr = fmtFullDate();

  const bodyHtml = `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0F2A3F;border-radius:10px 10px 0 0;">
      <tr><td style="padding:20px 24px;">
        <div style="color:#ffffff;font-size:18px;font-weight:700;">סיכום יומי · סוכן אשדוד</div>
        <div style="color:#B9C6D1;font-size:12px;margin-top:4px;">${esc(dateStr)} · שעה 15:00</div>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-left:1px solid #e2e2e2;border-right:1px solid #e2e2e2;">
      <tr><td style="padding:16px 24px 4px;color:#333333;font-size:13px;">שלום ${esc(deptName)}, להלן סיכום הפעילות שלכם היום:</td></tr>
      <tr><td style="padding:8px 16px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="50%" style="padding:6px;">${TILE('#E1F5EE', '#0F6E56', c.released, 'שוחררו באשדוד היום')}</td>
          <td width="50%" style="padding:6px;">${TILE('#E6F1FB', '#185FA5', c.transfers, 'העברות לחיפה היום')}</td>
        </tr><tr>
          <td width="50%" style="padding:6px;">${TILE('#F1EFE8', '#444441', c.statusChanges, 'שינויי סטטוס היום')}</td>
          <td width="50%" style="padding:6px;">${TILE('#FAECE7', '#993C1D', c.attention, `דורש טיפול ("יצא לחיפה" ${AGE_DAYS}+ ימים)`)}</td>
        </tr></table>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0F2A3F;">
      <tr><td style="padding:16px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="color:#CFE0EC;font-size:13px;vertical-align:middle;">סה״כ תיקים פעילים בדשבורד</td>
          <td align="left" style="color:#ffffff;font-family:'Courier New',Courier,monospace;font-size:22px;font-weight:800;vertical-align:middle;">${c.activeTotal}</td>
        </tr></table>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-left:1px solid #e2e2e2;border-right:1px solid #e2e2e2;">
      <tr><td align="center" style="padding:18px 24px;">
        <a href="${DASHBOARD_URL}" style="display:inline-block;background:#0F2A3F;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;padding:10px 28px;border-radius:6px;">כניסה למערכת סוכן כספי</a>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e2e2;border-top:none;border-radius:0 0 10px 10px;">
      <tr><td style="padding:12px 24px;color:#8a8a8a;font-size:10px;">דוח אוטומטי — סוכן כספי אשדוד. סיכום מונים נשלח מדי יום ב-15:00.</td></tr>
    </table>
  </div>`;

  return {
    from: config.sender_mailbox,
    to: to ? [to] : [],
    cc: [],
    subject: `סיכום יומי 15:00 — ${deptName} (${dept.toUpperCase()})`,
    bodyHtml,
  };
}

// מריץ את סיכום המונים (15:00): שולח לכל מחלקה תמיד — גם אם כל המונים 0.
async function runCountsReport(now = Date.now()) {
  if (!isEnabled()) {
    console.log('[dailyReport] הדגל daily_report כבוי — דילוג (סיכום מונים)');
    return { skipped: 'feature_off', at: new Date().toISOString() };
  }
  const byDept = collectCounts(now);
  const results = [];
  for (const dept of DEPTS) {
    const c = byDept[dept];
    const email = buildCountsEmail(dept, c);
    if (!email.to.length) {
      console.warn(`[dailyReport] אין כתובת מייל למחלקה ${dept} — דילוג (סיכום מונים)`);
      continue;
    }
    try {
      await graph.sendMail(email);
      console.log(`[dailyReport] נשלח סיכום מונים ל-${dept} (${email.to[0]}) — שוחררו ${c.released}, העברות ${c.transfers}, שינויי סטטוס ${c.statusChanges}, לטיפול ${c.attention}, פעילים בדשבורד ${c.activeTotal}`);
      results.push({ dept, to: email.to[0], counts: c, ok: true });
    } catch (e) {
      console.error(`[dailyReport] כשל שליחת סיכום מונים ל-${dept}: ${e.message}`);
      results.push({ dept, to: email.to[0], counts: c, ok: false, error: e.message });
    }
  }
  const summary = { kind: 'counts', sent: results.filter((r) => r.ok).length, results, at: new Date().toISOString() };
  lastCountsRun = summary;
  return summary;
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
let lastCountsRun = null;
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
    // דוח ההזדקנות ("יצא לחיפה" 2+ ימים) — בשני החלונות (09:00 ו-15:00)
    try { await runReport(); } catch (e) { console.error('[dailyReport]', e.message); }
    // סיכום המונים — רק בחלון 15:00 (נשלח תמיד, גם כשריק)
    if (new Date().getHours() === 15) {
      try { await runCountsReport(); } catch (e) { console.error('[dailyReport counts]', e.message); }
    }
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
  return { last: lastRun, lastCounts: lastCountsRun, nextRunAt, enabled: isEnabled() };
}

module.exports = {
  start, stop, status, runReport, runCountsReport,
  // חשוף לבדיקות
  collectStale, collectCounts, buildDeptEmail, buildCountsEmail, msUntilNextRun, isEnabled,
};
