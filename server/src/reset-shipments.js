/**
 * reset-shipments.js — איפוס מלא של טבלת המעקב וזריעה מחדש מהדוח הנוכחי.
 *
 * ⚠ הרסני: מוחק את כל רשומות shipments + status_history (טיוטות, הערות, היסטוריה)
 * ואז מריץ את ה-watcher פעם אחת כדי לזרוע מחדש רק את התיקים שבתחום (scope):
 * LCL + הנציג שהוגדר ב-config.report_scope, תחנת מכס 2 (אשדוד).
 *
 * שימוש חד-פעמי בעת מעבר למקור דוח חדש. שימוש: node src/reset-shipments.js
 */
const shipments = require('./db/shipments');
const reportWatcher = require('./services/reportWatcher');

function main() {
  const before = shipments.all().length;
  const histBefore = shipments.db.prepare('SELECT COUNT(*) n FROM status_history').get().n;

  const wipe = shipments.db.transaction(() => {
    shipments.db.prepare('DELETE FROM status_history').run();
    shipments.db.prepare('DELETE FROM shipments').run();
  });
  wipe();

  console.log('=== איפוס טבלת המעקב ===');
  console.log('  נמחקו shipments:', before, '| status_history:', histBefore);

  console.log('  זורע מחדש מהדוח (scope: LCL + נציג + אשדוד)…');
  const summary = reportWatcher.runOnce();
  console.log('  תוצאת זריעה:', JSON.stringify(summary));

  const after = shipments.all();
  const byDept = {};
  const byStatus = {};
  after.forEach((s) => {
    const d = s.department || '(none)';
    byDept[d] = (byDept[d] || 0) + 1;
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  });
  console.log('  shipments אחרי:', after.length);
  console.log('  לפי מחלקה:', JSON.stringify(byDept));
  console.log('  לפי סטטוס:', JSON.stringify(byStatus));
}

main();
