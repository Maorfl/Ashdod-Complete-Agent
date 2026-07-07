/**
 * cleanup-out-of-scope-cus1.js — ניקוי חד-פעמי (Task 2).
 *
 * הרקע: לפני שה-whitelist חובר ל-inScope, נכנסו לצנרת תיקים של לקוחות משה רוסו
 * (department=cus1) שאינם ברשימת 19 לקוחות ההעברה לחיפה. הם עדיין מוצגים תחת CUS1.
 * inScope המתוקן מונע כניסת חדשים — הסקריפט הזה מנקה את הישנים.
 *
 * מדיניות בטיחות (לפי הסטטוס):
 *   - status ∈ {pending_approval, alert}  => לא בוצעה שום פעולה בפועל => מחיקה בטוחה.
 *   - כל סטטוס אחר (sent / שוחרר / יצא / התקבל / נמסר / rejected ...) => נתונים
 *     היסטוריים שכבר בוצעו עליהם פעולות => לא נוגעים, מדווחים לבד למשתמש.
 *
 * הרצה יבשה (ברירת מחדל): מדפיס מה יימחק בלי לגעת. מחיקה בפועל: --apply.
 * שימוש: node scripts/cleanup-out-of-scope-cus1.js [--apply]
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const shipments = require(path.join(ROOT, 'server', 'src', 'db', 'shipments'));
const scope = require(path.join(ROOT, 'server', 'src', 'scope'));

const APPLY = process.argv.includes('--apply');
const SAFE_TO_REMOVE = new Set(['pending_approval', 'alert']);

function main() {
  const all = shipments.all();
  const cus1 = all.filter((r) => String(r.department || '').toLowerCase() === 'cus1');
  const outOfScope = cus1.filter((r) => !scope.isWhitelisted(r.customer_name));

  const toRemove = outOfScope.filter((r) => SAFE_TO_REMOVE.has(r.status));
  const declined = outOfScope.filter((r) => !SAFE_TO_REMOVE.has(r.status));

  console.log('=== cleanup-out-of-scope-cus1', APPLY ? '(APPLY)' : '(DRY-RUN)', '===');
  console.log('לפני:  סה"כ', all.length, '| cus1', cus1.length,
    '| cus1 ברשימה', cus1.length - outOfScope.length, '| cus1 מחוץ לרשימה', outOfScope.length);

  console.log(`\nלמחיקה (pending_approval/alert): ${toRemove.length}`);
  for (const r of toRemove) console.log(`  ${r.file_number}  ${r.customer_name}  [${r.status}]`);

  console.log(`\n⚠ לא נגעתי (התקדמו מעבר ל-pending/alert) — לבדיקת המשתמש: ${declined.length}`);
  for (const r of declined) console.log(`  ${r.file_number}  ${r.customer_name}  [${r.status}]`);

  if (APPLY) {
    let removed = 0;
    for (const r of toRemove) removed += shipments.remove(r.file_number);
    const after = shipments.all();
    const cus1After = after.filter((x) => String(x.department || '').toLowerCase() === 'cus1');
    const outAfter = cus1After.filter((x) => !scope.isWhitelisted(x.customer_name));
    console.log(`\nנמחקו: ${removed}`);
    console.log('אחרי: סה"כ', after.length, '| cus1', cus1After.length,
      '| cus1 מחוץ לרשימה', outAfter.length, '(אמור להיות שווה למספר ה"לא נגעתי")');
  } else {
    console.log('\n(הרצה יבשה — לא נמחק דבר. להרצה בפועל: --apply)');
  }
}

main();
