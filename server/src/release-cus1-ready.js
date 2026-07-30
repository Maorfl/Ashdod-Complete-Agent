/**
 * release-cus1-ready.js — שחרור חד-פעמי וממוקד: מנקה auto_send_excluded עבור תיקי
 * CUS1 שכבר מוכנים לשליחה (pending_approval + מסלול העברה-לחיפה אמיתי), כדי
 * שהאוטומציה (cus1='on') תוכל לשלוח אותם בקומיט הבא — בלי לגעת בשום תיק אחר.
 *
 * היקף (כל התנאים חייבים להתקיים):
 *   department = 'cus1'
 *   route ∈ {co_loader, terminal}
 *   status = 'pending_approval'
 * לא נוגע ב-CUS2/CUS3, ולא בתיקי CUS1 שהם alert/prepaid/direct/נדחו/כבר נשלחו.
 *
 * חד-פעמי ואידמפוטנטי: רשימת מספרי התיקים ששוחררו נשמרת ב-data/cus1-release-log.json.
 * אם הקובץ כבר קיים — הסקריפט מסרב לרוץ שוב (לא מרחיב היקף, לא משחרר שוב). למחיקת
 * ההגנה (למשל לצורך בדיקה) יש למחוק את קובץ הלוג ידנית — פעולה מכוונת, לא בטעות.
 *
 * לא משחרר שום תנאי שער אחר: PDF/מייל מוביל/needs_review/Graph ממשיכים להיבדק
 * כרגיל ב-reportWatcher.autoSendEnabled בקומיט הבא. אם תיק ששוחרר עדיין נכשל בתנאי
 * אחר — הוא נשאר מוחזק (awaiting_gatepass/pending_approval), וזו ההתנהגות הנכונה.
 *
 * לא שולח שום מייל בעצמו — רק מנקה את הדגל. השליחה בפועל (אם תקרה) תלויה בקומיט
 * הבא של reportWatcher, שרץ בשעון-הקיר הרגיל (או node src/index.js אם השרת רץ).
 *
 * שימוש: node src/release-cus1-ready.js
 */
const fs = require('fs');
const path = require('path');
const shipments = require('./db/shipments');
const { DATA_DIR } = require('./config');

const RELEASE_LOG_PATH = path.join(DATA_DIR, 'cus1-release-log.json');
const TRANSFER_ROUTES = new Set(['co_loader', 'terminal']);

function main() {
  if (fs.existsSync(RELEASE_LOG_PATH)) {
    const prev = JSON.parse(fs.readFileSync(RELEASE_LOG_PATH, 'utf8'));
    console.log('=== שחרור CUS1 — כבר בוצע בעבר, מסרב לרוץ שוב ===');
    console.log('  קובץ לוג קיים:', RELEASE_LOG_PATH);
    console.log('  בוצע ב:', prev.releasedAt);
    console.log('  תיקים ששוחררו אז:', prev.fileNumbers.join(', ') || '(אין)');
    console.log('  למחיקת ההגנה (מכוון בלבד) — מחקו את הקובץ ידנית והריצו שוב.');
    process.exit(0);
  }

  const candidates = shipments.all().filter((s) =>
    s.department === 'cus1' &&
    TRANSFER_ROUTES.has(s.route) &&
    s.status === 'pending_approval'
  );

  const released = [];
  for (const s of candidates) {
    shipments.db.prepare('UPDATE shipments SET auto_send_excluded = 0 WHERE file_number = ?').run(s.file_number);
    released.push({ file_number: s.file_number, customer_name: s.customer_name, route: s.route });
  }

  const logEntry = {
    releasedAt: new Date().toISOString(),
    fileNumbers: released.map((r) => r.file_number),
    details: released,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RELEASE_LOG_PATH, JSON.stringify(logEntry, null, 2) + '\n', 'utf8');

  console.log('=== שחרור CUS1 — הושלם ===');
  console.log('  מועמדים (cus1 + co_loader/terminal + pending_approval):', candidates.length);
  console.log('  שוחררו (auto_send_excluded=0):', released.length);
  for (const r of released) {
    console.log(`    ${r.file_number}  ${r.customer_name || '—'}  [${r.route}]`);
  }
  console.log('  קובץ לוג נשמר:', RELEASE_LOG_PATH);
  console.log('  הערה: לא נשלח שום מייל כאן. השליחה (אם קיימת זכאות מלאה) תקרה בקומיט הבא של reportWatcher.');
}

main();
