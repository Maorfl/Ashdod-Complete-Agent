/**
 * services/reportWatcher.js — לולאת ה-polling (מצב 1).
 * רץ כל poll_interval_minutes: קורא דוח, מסנן תיקים חדשים מול ה-DB, מסווג,
 * בונה טיוטת מייל ומכניס לתור אישור מחלקה. אינו שולח דבר בעצמו (human-in-the-loop).
 *
 * תיקי no_op אינם נשמרים ב-DB (לא רלוונטיים לאשדוד) — רק נספרים בסיכום הריצה,
 * כדי לשמור על טבלת shipments התפעולית נקייה. רק תיקים שדורשים פעולה נשמרים.
 */
const fs = require('fs');
const { config, REPORT_PATH } = require('../config');
const { readReport } = require('../report/reader');
const { classify } = require('../report/classifier');
const { composeRelease } = require('../email/composer');
const importersDb = require('../db/importers');
const shipments = require('../db/shipments');

const STATUS = { ALERT: 'alert', PENDING: 'pending_approval' };

let timer = null;
let lastRun = null;

function runOnce() {
  if (!config.feature_flags?.ashdod_release) return record({ skipped: 'feature_off' });
  if (!fs.existsSync(REPORT_PATH)) return record({ skipped: 'report_missing', path: REPORT_PATH });

  const { records } = readReport(REPORT_PATH);
  const summary = { total: records.length, no_op: 0, queued: 0, alerts: 0, skipped_tracked: 0, errors: 0 };

  for (const rec of records) {
    try {
      const decision = classify(rec, importersDb.findByName(rec.customer_name));

      if (decision.route === 'no_op') { summary.no_op += 1; continue; } // לא נשמר
      if (shipments.isTracked(rec.file_number)) {
        // תיק קיים — משלימים release_date מהדוח אם חסר (לא נוגעים בסטטוס/היסטוריה)
        if (rec.release_date && !shipments.get(rec.file_number)?.release_date) {
          shipments.upsert({ file_number: rec.file_number, release_date: rec.release_date });
        }
        summary.skipped_tracked += 1; continue; // כבר טופל/שוחרר
      }

      const importer = importersDb.findByName(rec.customer_name);

      if (decision.route === 'alert') {
        shipments.upsert({
          file_number: rec.file_number,
          customer_name: rec.customer_name,
          status: STATUS.ALERT,
          route: 'alert',
          reason: decision.reason,
          release_date: rec.release_date || null,
          department: importer?.department || null,
          hazardous: rec.hazardous,
          draft_payload: { decision },
        });
        summary.alerts += 1;
        continue;
      }

      // מסלול פעיל — בניית טיוטה והכנסה לתור אישור
      const email = composeRelease(rec, decision, importer);
      shipments.upsert({
        file_number: rec.file_number,
        customer_name: rec.customer_name,
        status: STATUS.PENDING,
        route: decision.route,
        reason: decision.reason || null,
        release_date: rec.release_date || null,
        department: importer?.department || null,
        co_loader_code: rec.co_loader_code || null,
        continuation: decision.continuation?.name || null,
        hazardous: rec.hazardous,
        wg_reshimon_no: rec.wg_reshimon_no || null,
        type: importer?.type || null,
        agent_name: importer?.service_rep || null,
        draft_payload: { route: decision.route, needs_review: !!decision.needs_review, email, alerts: decision.alerts || [] },
      });
      summary.queued += 1;
    } catch (e) {
      summary.errors += 1;
    }
  }

  return record({ ...summary, at: new Date().toISOString() });
}

function record(r) {
  lastRun = r;
  return r;
}

function start() {
  if (timer) return;
  const ms = (config.poll_interval_minutes || 10) * 60 * 1000;
  runOnce();
  timer = setInterval(runOnce, ms);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runOnce, start, stop, status: () => lastRun };
