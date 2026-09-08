/**
 * backfill-performer-display.js — עדכון חד-פעמי (אידמפוטנטי) של עמודת התצוגה
 * shipments.transfer_performer לשם העברי הרשום וללא סיומת תאגידית:
 *   "OCEAN LINK" -> "אושן לינק" ,  "קפלן לוגיסטיקה בע\"מ" -> "קפלן לוגיסטיקה"
 *
 * למה צריך: הצנרת מחשבת את ערך התצוגה בכל קומיט, אך תיקים שכבר במעקב עוברים
 * בנתיב skipped_tracked ואינם מרעננים את השדה — בלי הסקריפט הזה שורות ותיקות
 * היו ממשיכות להציג את השם האנגלי מהדוח.
 *
 * תצוגה בלבד: אינו נוגע ב-co_loaders.json/terminals.json ואינו משנה נמענים,
 * סטטוסים או טיוטות. בטוח להרצה חוזרת.
 *
 * שימוש:  node scripts/backfill-performer-display.js [--dry]
 */
const path = require('path');
const Database = require('better-sqlite3');
const contacts = require('../server/src/db/contacts');
const grammar = require('../server/src/email/grammar');

const DRY = process.argv.includes('--dry');
const db = new Database(path.join(__dirname, '..', 'data', 'shipments.db'));

const rows = db.prepare(
  "SELECT file_number, transfer_performer FROM shipments WHERE transfer_performer IS NOT NULL AND transfer_performer <> ''"
).all();

const upd = db.prepare('UPDATE shipments SET transfer_performer = ? WHERE file_number = ?');
let changed = 0;
const samples = [];
const apply = db.transaction((list) => {
  for (const r of list) {
    const next = grammar.displayName(contacts.displayNameFor(r.transfer_performer));
    if (!next || next === r.transfer_performer) continue;
    if (samples.length < 15) samples.push(`${r.file_number}: ${r.transfer_performer}  ->  ${next}`);
    changed += 1;
    if (!DRY) upd.run(next, r.file_number);
  }
});
apply(rows);

console.log(`נסרקו ${rows.length} תיקים; ${DRY ? 'ישתנו' : 'עודכנו'} ${changed}`);
for (const s of samples) console.log('  ' + s);
if (changed > samples.length) console.log(`  ... ועוד ${changed - samples.length}`);
if (DRY) console.log('\n(dry run — לא בוצעה כתיבה)');
