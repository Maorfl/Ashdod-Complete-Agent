/**
 * services/retention.js — שתי מדיניויות שמירה (Tasks 4+5, 2026-07-07):
 *
 * 1. deliveredCleanup — יומי (interval פשוט): תיקים בסטטוס 'נמסר ללקוח' שהסטטוס
 *    עודכן לפני יותר מ-retention.delivered_days (21) נמחקים מ-shipments +
 *    status_history. בלתי הפיך — לכן כל מחיקה נרשמת ללוג לפני ביצוע.
 *
 * 2. pdfCleanup — יומי בשעה 07:00, מיושר לשעון קיר (אותה טכניקת setTimeout
 *    self-rescheduling כמו קומיט ה-HH:55 ב-reportWatcher — מחשבים delay מ-now טרי,
 *    לא setInterval שצובר drift): קבצי PDF בתיקיות היבואנים (data/importers/<שם>/*.pdf)
 *    שגילם לפי mtime עולה על retention.gatepass_pdf_days (21) נמחקים, ו-
 *    gatepass_pdf_path של התיק המצביע עליהם מנוקה כדי שה-UI לא יפנה לקובץ שנמחק.
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const shipments = require('../db/shipments');
const importersDb = require('../db/importers');

const DELIVERED_STATUS = 'נמסר ללקוח';
const DAY_MS = 24 * 60 * 60 * 1000;

function settings() {
  const r = config.retention || {};
  return {
    deliveredDays: Number(r.delivered_days ?? 21),
    pdfDays: Number(r.gatepass_pdf_days ?? 21),
    pdfHour: Number(r.pdf_cleanup_hour ?? 7),
  };
}

// ---------- Task 4: מחיקת תיקים שנמסרו לפני יותר מ-21 יום ----------
function deliveredCleanup() {
  const { deliveredDays } = settings();
  const cutoff = Date.now() - deliveredDays * DAY_MS;
  const stale = shipments.byStatus(DELIVERED_STATUS)
    .filter((s) => s.status_updated_at && Date.parse(s.status_updated_at) < cutoff);

  if (!stale.length) return { removed: 0 };
  console.log(`[retention] מוחק ${stale.length} תיקי "${DELIVERED_STATUS}" ישנים מ-${deliveredDays} יום:`);
  for (const s of stale) {
    console.log(`  ${s.file_number}  ${s.customer_name || ''}  (נמסר: ${s.status_updated_at})`);
    shipments.remove(s.file_number);
  }
  return { removed: stale.length, at: new Date().toISOString() };
}

// ---------- Task 5: מחיקת קבצי gatepass PDF ישנים מ-21 יום ----------
function pdfCleanup() {
  const { pdfDays } = settings();
  const cutoff = Date.now() - pdfDays * DAY_MS;
  const removed = [];

  if (fs.existsSync(importersDb.IMP_ROOT)) {
    for (const dir of fs.readdirSync(importersDb.IMP_ROOT, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const folder = path.join(importersDb.IMP_ROOT, dir.name);
      for (const f of fs.readdirSync(folder)) {
        if (!/\.pdf$/i.test(f)) continue;
        const p = path.join(folder, f);
        try {
          if (fs.statSync(p).mtimeMs >= cutoff) continue;
          fs.unlinkSync(p);
          removed.push(p);
          console.log(`[retention] נמחק PDF ישן מ-${pdfDays} יום: ${p}`);
          // ניקוי המצביע בתיק שמפנה לקובץ שנמחק — שה-UI לא יציג "PDF מצורף" שווא
          shipments.db.prepare('UPDATE shipments SET gatepass_pdf_path=NULL WHERE gatepass_pdf_path=?').run(p);
        } catch (e) {
          console.warn(`[retention] כשל במחיקת ${p}: ${e.message}`);
        }
      }
    }
  }
  return { removed: removed.length, at: new Date().toISOString() };
}

// ---------- תזמון ----------
let dailyTimer = null;
let pdfTimer = null;
let lastRun = { delivered: null, pdf: null };

// ms עד השעה H:00 הבאה, מחושב תמיד מ-now אמיתי (יישור לשעון קיר, כמו HH:55 בקומיט)
function msUntilNextHour(hour, now = new Date()) {
  const t = new Date(now);
  t.setHours(hour, 0, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime() - now.getTime();
}

function schedulePdfCleanup() {
  const delay = msUntilNextHour(settings().pdfHour);
  pdfTimer = setTimeout(() => {
    try { lastRun.pdf = pdfCleanup(); } catch (e) { console.error('[retention] pdfCleanup:', e.message); }
    schedulePdfCleanup(); // רה-תזמון מ-now טרי
  }, delay);
}

function start() {
  if (dailyTimer || pdfTimer) return;
  // ניקוי תיקים שנמסרו — ריצה מיידית + כל 24 שעות (לא דורש יישור מדויק)
  try { lastRun.delivered = deliveredCleanup(); } catch (e) { console.error('[retention] deliveredCleanup:', e.message); }
  dailyTimer = setInterval(() => {
    try { lastRun.delivered = deliveredCleanup(); } catch (e) { console.error('[retention] deliveredCleanup:', e.message); }
  }, DAY_MS);
  // ניקוי PDF — מיושר ל-07:00
  schedulePdfCleanup();
}

function stop() {
  if (dailyTimer) clearInterval(dailyTimer);
  if (pdfTimer) clearTimeout(pdfTimer);
  dailyTimer = pdfTimer = null;
}

module.exports = { start, stop, deliveredCleanup, pdfCleanup, msUntilNextHour, status: () => lastRun };
