/**
 * recompose-drafts.js — רענון טיוטות קיימות בתור האישורים לפורמט הנוכחי של הקומפוזר.
 *
 * הצורך: ה-watcher מדלג על תיקים שכבר במעקב, ולכן טיוטות שנוצרו לפני שינוי פורמט
 * המייל נשארות בפורמט הישן. סקריפט זה מרכיב מחדש את draft_payload.email עבור תיקים
 * שממתינים לאישור במסלול co_loader/terminal — לפי הדוח הנוכחי + נתוני היבואן.
 *
 * בטוח: לא שולח דבר, לא משנה סטטוס/היסטוריה — רק מעדכן את גוף הטיוטה. אפס תלות ב-LLM.
 * שימוש: node src/recompose-drafts.js   (או npm run recompose)
 */
const { readReport } = require('./report/reader');
const { classify } = require('./report/classifier');
const { composeRelease } = require('./email/composer');
const imp = require('./db/importers');
const shipments = require('./db/shipments');
const { REPORT_PATH } = require('./config');

function main() {
  const { records } = readReport(REPORT_PATH);
  const byFile = new Map(records.map((r) => [String(r.file_number), r]));

  const pending = shipments.byStatus('pending_approval')
    .filter((r) => r.route === 'co_loader' || r.route === 'terminal');

  const summary = { candidates: pending.length, recomposed: 0, not_in_report: 0, route_changed: 0, errors: 0 };

  for (const ship of pending) {
    try {
      const rec = byFile.get(String(ship.file_number));
      if (!rec) { summary.not_in_report += 1; continue; }

      const importer = imp.findByName(rec.customer_name);
      const decision = classify(rec, importer);
      if (decision.route !== 'co_loader' && decision.route !== 'terminal') {
        summary.route_changed += 1; continue;
      }

      const email = composeRelease(rec, decision, importer);

      // שימור שאר שדות ה-payload (needs_review, alerts, route) — רק המייל מתרענן
      let payload = {};
      try { payload = ship.draft_payload ? JSON.parse(ship.draft_payload) : {}; } catch { payload = {}; }
      payload.email = email;
      payload.route = decision.route;
      payload.needs_review = !!decision.needs_review;

      shipments.upsert({ file_number: ship.file_number, draft_payload: payload });
      summary.recomposed += 1;
    } catch (e) {
      summary.errors += 1;
      console.error('  שגיאה בתיק', ship.file_number, '—', e.message);
    }
  }

  console.log('=== רענון טיוטות (co_loader/terminal) ===');
  console.log('  מועמדים:', summary.candidates);
  console.log('  רועננו לפורמט חדש:', summary.recomposed);
  console.log('  לא נמצאו בדוח הנוכחי (דולגו):', summary.not_in_report);
  console.log('  שינוי מסלול (דולגו):', summary.route_changed);
  console.log('  שגיאות:', summary.errors);
}

main();
