/**
 * import-forwarder-table.js — Task 2
 * קורא את טבלת "סוכני אניה/משלחים" (עמודות שם סוכן / סוכן אניה-משלח / Code) ומעדכן
 * את config/co_loaders.json:
 *   - קוד קיים  -> מעדכן רק את name (+ מוסיף/מעדכן kind), שאר השדות (emails/contact/
 *     gender/number/needs_review) נשארים כפי שהם.
 *   - קוד חדש   -> נוסף כרשומה חדשה עם emails:[] + needs_review:true (בטיחות —
 *     קוד שלא זוהה היה עד כה 'alert' ידני; בלי הדגל הזה הוא היה הופך לשליחה
 *     אוטומטית לנמען לא-מאומת).
 * קודים מנורמלים לצורה הקנונית הלא-מרופדת (Number->String) כדי להתאים למפתחות
 * הקיימים ("641" לא "0641") ול-getCoLoaderByCode (db/contacts.js) שאינו מנרמל בעצמו.
 * קוד קיים שלא מופיע בטבלה (למשל 15373) אינו נגע כלל — הטבלה רק מוסיפה/מעדכנת.
 *
 * אידמפוטנטי: הרצה חוזרת על אותה טבלה מניבה אותה תוצאה (name/kind מתעדכנים לאותו
 * ערך, לא נוצרות כפילויות). יוצר גיבוי חד-פעמי לפני הכתיבה הראשונה בכל הרצה.
 *
 * שימוש: node scripts/import-forwarder-table.js [path-to-xlsx]
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CO_PATH = path.join(ROOT, 'config', 'co_loaders.json');

const argPath = process.argv[2];
const xlsxPath = argPath
  ? path.resolve(argPath)
  : path.resolve('C:\\Users\\maorf\\Downloads\\TaskYam-טבלת סוכני אניה.xlsx');

function normCode(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s; // קודים לא-מספריים (לא צפויים) נשארים כפי שהם
}

function loadTable(file) {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const [header, ...data] = rows;
  const at = {
    name: header.indexOf('שם סוכן'),
    kind: header.indexOf('סוכן אניה/משלח'),
    code: header.indexOf('Code'),
  };
  return data
    .map((r) => ({
      name: String(r[at.name] ?? '').trim(),
      kind: String(r[at.kind] ?? '').trim(),
      code: normCode(r[at.code]),
    }))
    .filter((r) => r.code && r.name);
}

function main() {
  const doc = JSON.parse(fs.readFileSync(CO_PATH, 'utf8'));
  const coLoaders = doc.co_loaders;

  const backupPath = `${CO_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(CO_PATH, backupPath);

  const table = loadTable(xlsxPath);

  const updated = [];
  const added = [];
  const seenCodes = new Set();
  for (const row of table) {
    if (seenCodes.has(row.code)) continue; // הטבלה מאומתת ללא כפילויות, אך שומרים על אידמפוטנטיות בכל זאת
    seenCodes.add(row.code);

    const existing = coLoaders[row.code];
    if (existing) {
      const oldName = existing.name;
      existing.name = row.name;
      existing.kind = row.kind;
      if (oldName !== row.name) updated.push({ code: row.code, oldName, newName: row.name });
    } else {
      coLoaders[row.code] = {
        name: row.name,
        kind: row.kind,
        emails: [],
        needs_review: true,
      };
      added.push({ code: row.code, name: row.name, kind: row.kind });
    }
  }

  fs.writeFileSync(CO_PATH, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  console.log(`=== ייבוא טבלת סוכני אניה/משלחים ===`);
  console.log(`מקור: ${xlsxPath}`);
  console.log(`גיבוי: ${backupPath}`);
  console.log(`שורות בטבלה: ${table.length}`);
  console.log(`עודכנו (שם): ${updated.length}`);
  for (const u of updated) console.log(`  ${u.code}: "${u.oldName}" -> "${u.newName}"`);
  console.log(`נוספו חדשים: ${added.length} (כולם emails:[] + needs_review:true)`);

  const flag484 = updated.find((u) => u.code === '484');
  if (flag484) {
    console.log('');
    console.log('*** שים לב — קוד 484 ***');
    console.log(`   השם שונה מ-"${flag484.oldName}" ל-"${flag484.newName}" — לפי הטבלה ישות שונה`);
    console.log('   מ-958 (ישראל קארגו האמיתי). contact/emails הקיימים (סנדרה) נשארו');
    console.log('   כפי שהם תחת השם החדש — נדרשת החלטה אנושית, לא נעשה כאן.');
  }

  const untouched15373 = coLoaders['15373'];
  console.log('');
  console.log(`קוד 15373 (SPARTA CARGO) — ${table.some((r) => r.code === '15373') ? 'נמצא בטבלה' : 'לא נמצא בטבלה, נשאר ללא שינוי'}: ${untouched15373 ? untouched15373.name : '—'}`);
}

main();
