/**
 * services/gatepassFetcher.js — Task 6: איתור וצירוף ה-PDF הנכנס לפי מספר תיק.
 *
 * ה-gatepass מגיע לתיבת ashdod.agent@ מהשולח do-not-reply@h-caspi.co.il.
 * נצפה בפועל (בסשן הזה) שנושא ההודעה בפורמט:
 *   "Event: הותר-Declaration State DISPATCH NOTE - FILE NUMBER <מספר תיק>"
 * לכן מספר התיק מזוהה מהנושא לפי "FILE NUMBER <ספרות>" (עם fallback לכל רצף ספרות
 * התואם את מספר התיק, כולל bodyPreview). אין ניחוש עיוור — התאמה מול מספר התיק המבוקש.
 *
 * שומר את הצרופה בתיקיית היבואן של הלקוח — data/importers/<שם>/<מספר תיק>.pdf —
 * ומעדכן gatepass_pdf_path ברשומת התיק (fallback ל-data/attachments אם אין תיקיה).
 * אפס תלות ב-LLM. שליחה — לפי מדיניות האישור/הדגל auto_send_haifa_transfer.
 */
const fs = require('fs');
const path = require('path');
const { config, DATA_DIR } = require('../config');
const graph = require('./graphMail');
const shipments = require('../db/shipments');
const importersDb = require('../db/importers');

const GATEPASS_SENDER = (config.microsoft_graph?.gatepass_sender) || 'do-not-reply@h-caspi.co.il';
const ATTACH_ROOT = path.join(DATA_DIR, 'attachments'); // fallback בלבד — ראו saveAttachment

let timer = null;
let lastRun = null;

// חילוץ מספר התיק מנושא/תקציר ההודעה
function extractFileNumber(msg) {
  const text = `${msg.subject || ''}\n${msg.bodyPreview || ''}`;
  const m = text.match(/FILE\s*NUMBER\s*[:#-]?\s*(\d{5,})/i);
  if (m) return m[1];
  return null;
}

function safeName(name) {
  return String(name || 'gatepass.pdf').replace(/[^\w.\-]+/g, '_');
}

/** ההודעה תואמת את התיק? (מספר התיק בנושא/תקציר) */
function messageMatchesFile(msg, fileNumber) {
  const extracted = extractFileNumber(msg);
  if (extracted && extracted === String(fileNumber)) return true;
  // fallback: מספר התיק מופיע כרצף שלם בנושא/תקציר
  const text = `${msg.subject || ''}\n${msg.bodyPreview || ''}`;
  return new RegExp(`(^|\\D)${fileNumber}(\\D|$)`).test(text);
}

/**
 * יעד השמירה: תיקיית היבואן של הלקוח — data/importers/<שם>/<מספר תיק>.pdf.
 * הפתרון לפי customer_name של התיק דרך findByName/safeFolder הקיימים (לא סכמת שמות
 * שנייה). אם אין תיקיית יבואן תואמת (לא אמור לקרות ללקוחות ה-whitelist) — fallback
 * למיקום הישן data/attachments/<מספר תיק>/ עם אזהרה מפורשת, לא כשל שקט.
 */
function resolveDest(fileNumber, att) {
  const rec = shipments.get(fileNumber);
  const imp = rec?.customer_name ? importersDb.findByName(rec.customer_name) : null;
  if (imp) {
    return { dir: path.join(importersDb.IMP_ROOT, imp._folder), file: `${fileNumber}.pdf` };
  }
  console.warn(`[gatepassFetcher] no importer folder for file ${fileNumber} (customer: ${rec?.customer_name || '?'}) — falling back to data/attachments`);
  return { dir: path.join(ATTACH_ROOT, String(fileNumber)), file: safeName(att.name) };
}

async function saveAttachment(fileNumber, att) {
  if (!att.contentBytes) return null; // רק fileAttachment עם תוכן
  const { dir, file } = resolveDest(fileNumber, att);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, file);
  fs.writeFileSync(dest, Buffer.from(att.contentBytes, 'base64'));
  return dest;
}

/**
 * fetchForFile — מחפש את ה-gatepass של תיק בודד ושומר אותו.
 * מחזיר { file, path } בהצלחה, או { file, skipped } אם לא נמצא.
 */
async function fetchForFile(fileNumber) {
  if (!graph.isEnabled()) return { file: fileNumber, skipped: 'graph_disabled' };
  const existing = shipments.get(fileNumber);
  if (existing?.gatepass_pdf_path && fs.existsSync(existing.gatepass_pdf_path)) {
    return { file: fileNumber, path: existing.gatepass_pdf_path, cached: true };
  }

  // חיפוש תחום לטווח הימים האחרונים (gatepass_lookback_days) — לא $top שטוח לא-ממוין
  const messages = await graph.searchFrom(config.sender_mailbox, GATEPASS_SENDER, {
    sinceDays: graph.settings().gatepassLookbackDays,
  });
  const match = messages.find((m) => m.hasAttachments && messageMatchesFile(m, fileNumber));
  if (!match) return { file: fileNumber, skipped: 'no_match' };

  const attachments = await graph.listAttachments(config.sender_mailbox, match.id);
  const pdf = attachments.find((a) => /pdf$/i.test(a.name || '') || a.contentType === 'application/pdf');
  if (!pdf) return { file: fileNumber, skipped: 'no_pdf' };

  const saved = await saveAttachment(fileNumber, pdf);
  if (!saved) return { file: fileNumber, skipped: 'not_file_attachment' };
  shipments.setGatepass(fileNumber, saved);
  return { file: fileNumber, path: saved };
}

/**
 * מעבר על תיקים שממתינים לאישור בלי PDF וניסיון לאתר עבורם.
 * יעיל: שולף את הודעות do-not-reply פעם אחת ומתאים מולן את כל התיקים
 * (במקום קריאת mailbox נפרדת לכל תיק), ומוריד צרופה רק להתאמה בפועל.
 */
async function runOnce() {
  if (!config.feature_flags?.haifa_arrival) return record({ skipped: 'feature_off' });
  if (!graph.isEnabled()) return record({ skipped: 'graph_disabled' });

  const pending = shipments.byStatus('pending_approval').filter((r) => !r.gatepass_pdf_path);
  const summary = { checked: pending.length, found: 0, errors: 0, details: [] };

  let messages;
  try {
    // תחום לטווח הימים האחרונים — מגיע להודעות החדשות באמת (ראו הערה ב-searchFrom)
    messages = await graph.searchFrom(config.sender_mailbox, GATEPASS_SENDER, {
      sinceDays: graph.settings().gatepassLookbackDays,
    });
  } catch (e) {
    return record({ ...summary, errors: pending.length, fatal: e.message, at: new Date().toISOString() });
  }
  summary.sender_messages = messages.length;

  for (const rec of pending) {
    try {
      const match = messages.find((m) => m.hasAttachments && messageMatchesFile(m, rec.file_number));
      if (!match) continue;
      const attachments = await graph.listAttachments(config.sender_mailbox, match.id);
      const pdf = attachments.find((a) => /pdf$/i.test(a.name || '') || a.contentType === 'application/pdf');
      if (!pdf) continue;
      const saved = await saveAttachment(rec.file_number, pdf);
      if (!saved) continue;
      shipments.setGatepass(rec.file_number, saved);
      summary.found += 1;
      summary.details.push({ file: rec.file_number, path: saved });
    } catch (e) {
      summary.errors += 1;
      summary.details.push({ file: rec.file_number, error: e.message });
    }
  }
  return record({ ...summary, at: new Date().toISOString() });
}

function record(r) { lastRun = r; return r; }

function start() {
  if (timer || !graph.isEnabled()) return;
  const ms = graph.settings().pollMinutes * 60 * 1000;
  runOnce().catch(() => {});
  timer = setInterval(() => runOnce().catch(() => {}), ms);
}

function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { runOnce, fetchForFile, start, stop, status: () => lastRun, GATEPASS_SENDER };
