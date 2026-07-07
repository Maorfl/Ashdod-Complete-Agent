/**
 * reset-shipments.js — איפוס מלא של טבלת המעקב וזריעה מחדש מהדוח הנוכחי.
 *
 * ⚠ הרסני: מוחק את כל רשומות shipments + status_history ואז מריץ scan+commit מלא
 * כדי לזרוע מחדש רק את התיקים שבתחום (LCL + נציג + רשימת לקוחות ההעברה לחיפה).
 *
 * בטיחות מובנית:
 *   1. גיבוי עם חותמת זמן ל-data/shipments.backup-<timestamp>.db לפני כל מחיקה
 *      (אחרי wal_checkpoint כדי שהקובץ יהיה שלם ועקבי).
 *   2. תיקים בסטטוס 'sent' נלכדים לפני המחיקה ומסומנים שוב 'sent' אחרי הזריעה —
 *      כדי ש-ownsFile ימשיך למנוע שליחה כפולה לתיקים שכבר נשלח עבורם מייל.
 *   3. אין להריץ כשהשרת פעיל (writer חי על אותו קובץ SQLite).
 *
 * שימוש חד-פעמי בעת מעבר למקור דוח חדש. שימוש: node src/reset-shipments.js
 */
const fs = require('fs');
const path = require('path');
const shipments = require('./db/shipments');
const reportWatcher = require('./services/reportWatcher');
const { config, DATA_DIR, REPORT_PATH } = require('./config');

async function main() {
  console.log('=== איפוס טבלת המעקב ===');
  console.log('  מקור הדוח:', REPORT_PATH, fs.existsSync(REPORT_PATH) ? '(נגיש ✓)' : '(!! לא נגיש — הזריעה תדלג)');

  // 1 — גיבוי עקבי לפני מחיקה
  shipments.db.pragma('wal_checkpoint(TRUNCATE)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(DATA_DIR, `shipments.backup-${stamp}.db`);
  fs.copyFileSync(path.join(DATA_DIR, 'shipments.db'), backupPath);
  console.log('  גיבוי נשמר:', backupPath);

  // 2 — לכידת תיקים שכבר נשלחו (למניעת שליחה כפולה אחרי הזריעה)
  const sentBefore = shipments.all().filter((s) => s.status === (config.tracking?.sent_status || 'sent'));
  console.log('  תיקים בסטטוס sent שיישמרו:', sentBefore.map((s) => s.file_number).join(', ') || '(אין)');

  const before = shipments.all().length;
  const histBefore = shipments.db.prepare('SELECT COUNT(*) n FROM status_history').get().n;

  const wipe = shipments.db.transaction(() => {
    shipments.db.prepare('DELETE FROM status_history').run();
    shipments.db.prepare('DELETE FROM shipments').run();
  });
  wipe();
  console.log('  נמחקו shipments:', before, '| status_history:', histBefore);

  if (config.feature_flags?.auto_send_haifa_transfer) {
    console.warn('  ⚠ auto_send_haifa_transfer פעיל — הזריעה מחדש עלולה לשלוח אוטומטית מיילי העברה לחיפה!');
  }
  console.log('  זורע מחדש מהדוח (scope: LCL + נציג + 19 לקוחות ההעברה לחיפה)…');
  const summary = await reportWatcher.runOnce();
  console.log('  תוצאת זריעה:', JSON.stringify(summary));

  // 3 — שחזור סימון sent לתיקים שנקלטו שוב מהדוח
  let restored = 0;
  for (const s of sentBefore) {
    if (shipments.isTracked(s.file_number)) {
      shipments.markSent(s.file_number, 'שוחזר לאחר איפוס — נשלח בעבר (' + (s.agent_sent_at || '') + ')', { auto: !!s.auto_sent });
      restored += 1;
    }
  }
  if (sentBefore.length) console.log(`  שוחזרו סימוני sent: ${restored}/${sentBefore.length}`);

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
