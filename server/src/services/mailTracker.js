/**
 * services/mailTracker.js — מצב 2: מעקב הגעות לחיפה דרך תיבת ashdod.agent.
 * סורק הודעות שלא נקראו, מזהה שולחי הגעה (goldbond/sme/overseas לפי terminals.json),
 * מחלץ מספר תיק לפי כללי הזיהוי, ומעדכן רק תיקים ש-ownsFile מאשר (מניעת כפילות).
 *
 * ההודעה החוזרת (תגובת הגעה) אינה נשלחת — נכנסת לתור האישורים כטיוטה.
 * Human-in-the-loop נשמר במלואו. אפס תלות ב-LLM.
 */
const { config, haifaSenders } = require('../config');
const graph = require('./graphMail');
const shipments = require('../db/shipments');
const { composeArrival } = require('../email/composer');

let timer = null;
let lastRun = null;

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

// זיהוי המסוף השולח לפי כתובת ה-from של ההודעה
function matchSender(fromAddr) {
  const addr = norm(fromAddr);
  for (const [key, rule] of Object.entries(haifaSenders || {})) {
    const froms = Array.isArray(rule.from) ? rule.from : [rule.from];
    if (froms.some((f) => norm(f) === addr)) return { key, rule };
  }
  return null;
}

// חילוץ מזהה לפי כללי המסוף: מיקום (subject/body) + pattern
function extractId(message, rule) {
  const text = rule.id_in === 'body'
    ? `${message.bodyPreview || ''}\n${message.body?.content || ''}`
    : message.subject || '';
  const idx = text.indexOf(rule.pattern);
  if (idx === -1) return null;
  const after = text.slice(idx + rule.pattern.length);
  const m = after.match(/\d{4,}/); // המזהה הראשון (תיק/רשימון) אחרי ה-pattern
  return m ? m[0] : null;
}

// איתור התיק: ברירת מחדל לפי מספר תיק; overseas לפי מספר רשימון
function resolveShipment(id, rule) {
  if (rule.lookup_by === 'wg_reshimon_no') {
    return shipments.db.prepare('SELECT * FROM shipments WHERE wg_reshimon_no = ?').get(id) || null;
  }
  return shipments.get(id);
}

// הודעות שכבר נסרקו בתהליך הנוכחי — נמנעים מסריקה חוזרת בלי לגעת בדגל "נקרא"
const seen = new Set();

async function processMessage(msg) {
  if (seen.has(msg.id)) return { skipped: 'seen' };
  seen.add(msg.id);

  const fromAddr = msg.from?.emailAddress?.address;
  const match = matchSender(fromAddr);
  if (!match) return { skipped: 'unknown_sender' }; // לא שולח הגעה — לא נוגעים

  const id = extractId(msg, match.rule);
  if (!id) return { skipped: 'no_id', terminal: match.key };

  const rec = resolveShipment(id, match.rule);
  if (!rec) return { skipped: 'not_found', id, terminal: match.key };
  if (!shipments.ownsFile(rec.file_number)) return { skipped: 'not_owned', file: rec.file_number };

  // עדכון מעקב + טיוטת תגובת הגעה לתור האישורים (לא נשלח דבר).
  // רק הודעה שעובדה בפועל מסומנת כנקראה — לא נוגעים בשאר התיבה.
  shipments.setStatus(rec.file_number, 'התקבל בחיפה', `הגעה זוהתה במייל מ-${match.key} (${fromAddr})`);
  const email = composeArrival(rec, match.key);
  shipments.upsert({
    file_number: rec.file_number,
    status: 'pending_approval',
    notes: 'התקבל בחיפה — תגובת הגעה ממתינה לאישור',
    draft_payload: { route: 'arrival', arrival: true, terminal: match.key, email },
  });
  await graph.markRead(config.sender_mailbox, msg.id);
  return { processed: rec.file_number, terminal: match.key };
}

async function runOnce() {
  if (!config.feature_flags?.haifa_arrival) return record({ skipped: 'feature_off' });
  if (!graph.isEnabled()) return record({ skipped: 'graph_disabled' });

  const summary = { scanned: 0, processed: 0, skipped: 0, errors: 0, details: [] };
  try {
    const messages = await graph.listUnread(config.sender_mailbox);
    summary.scanned = messages.length;
    for (const msg of messages) {
      try {
        const r = await processMessage(msg);
        if (r.processed) { summary.processed += 1; summary.details.push(r); }
        else summary.skipped += 1;
      } catch (e) {
        summary.errors += 1;
        summary.details.push({ error: e.message, subject: msg.subject });
      }
    }
  } catch (e) {
    summary.errors += 1;
    summary.fatal = e.message;
  }
  return record({ ...summary, at: new Date().toISOString() });
}

function record(r) {
  lastRun = r;
  return r;
}

function start() {
  if (timer || !graph.isEnabled()) return;
  const ms = graph.settings().pollMinutes * 60 * 1000;
  runOnce().catch(() => {});
  timer = setInterval(() => runOnce().catch(() => {}), ms);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runOnce, start, stop, status: () => lastRun };
