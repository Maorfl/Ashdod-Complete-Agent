/**
 * test-pipeline.js — מריץ את כל הצנרת על הדוח האמיתי בלי לשלוח אף מייל.
 *   reader -> classifier -> composer, ומדפיס סטטיסטיקת ניתוב + בדיקות שפיות.
 *
 * שימוש: node src/test-pipeline.js   (או npm run test:pipeline)
 * אפס תלות ב-LLM. אינו נוגע ב-DB ואינו שולח דואר.
 */
const { readReport } = require('./report/reader');
const { classify } = require('./report/classifier');
const { composeRelease } = require('./email/composer');
const imp = require('./db/importers');
const { REPORT_PATH, config } = require('./config');

const EXT = config.external_email_override;

function main() {
  const { records, headerRow } = readReport(REPORT_PATH);

  const routes = {};
  const reasons = {};
  let needEmail = 0;
  let extTo = 0;
  let leaks = [];
  let hazRoutable = 0;
  let needsReview = 0;
  const samples = {};
  const errors = [];

  for (const rec of records) {
    let decision, mail;
    try {
      const importer = imp.findByName(rec.customer_name);
      decision = classify(rec, importer);
      routes[decision.route] = (routes[decision.route] || 0) + 1;
      if (decision.reason) reasons[decision.reason] = (reasons[decision.reason] || 0) + 1;
      if (decision.needs_review) needsReview++;
      if (decision.continuation?.hazardous) hazRoutable++;

      if (!decision.needs_email) continue;
      needEmail++;
      mail = composeRelease(rec, decision, importer);

      // בדיקת override: כל נמען To חייב להיות הכתובת היחידה החיצונית
      for (const to of mail.to) {
        extTo++;
        if (to !== EXT) leaks.push({ file: rec.file_number, to });
      }
      // ה-CC חייב להיות פנימי בלבד (אסור override שם)
      for (const cc of mail.cc) {
        if (cc === EXT) leaks.push({ file: rec.file_number, cc });
      }
      if (!samples[decision.route]) samples[decision.route] = { file: rec.file_number, to: mail.to, cc: mail.cc, subject: mail.subject };
    } catch (e) {
      errors.push({ file: rec.file_number, error: e.message });
    }
  }

  const pad = (n) => String(n).padStart(5);
  console.log('=== Caspi Agent — Test Pipeline (ללא שליחת מיילים) ===');
  console.log('דוח:', REPORT_PATH);
  console.log('שורת כותרות (0-based):', headerRow, '| שורות נתונים:', records.length);
  const withRelease = records.filter((r) => r.release_date).length;
  console.log('רשומות עם release_date:', withRelease + '/' + records.length,
    '| דוגמה:', records.find((r) => r.release_date)?.release_date || '—');

  console.log('\n--- ניתוב לפי מסלול ---');
  Object.entries(routes).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + pad(v) + '  ' + k));

  console.log('\n--- סיבות (reason) ---');
  Object.entries(reasons).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + pad(v) + '  ' + k));

  console.log('\n--- בדיקות שפיות ---');
  console.log('  מיילים שדורשים שליחה (needs_email):', needEmail);
  console.log('  נמעני To חיצוניים שנבדקו:', extTo);
  console.log('  דליפות (To/CC לא דרך override):', leaks.length, leaks.length ? JSON.stringify(leaks.slice(0, 5)) : '✓ אין');
  console.log('  מטען מסוכן במסלולים פעילים → סמא:', hazRoutable);
  console.log('  מסומנים needs_review:', needsReview);
  console.log('  שגיאות עיבוד:', errors.length, errors.length ? JSON.stringify(errors.slice(0, 5)) : '✓ אין');

  console.log('\n--- דוגמת נמענים לכל מסלול ---');
  for (const [route, s] of Object.entries(samples)) {
    console.log(`  ${route}: To=${JSON.stringify(s.to)} CC=${JSON.stringify(s.cc)}`);
  }

  // קריטריוני קבלה
  const total = Object.values(routes).reduce((a, b) => a + b, 0);
  const pass = leaks.length === 0 && errors.length === 0 && total === records.length;
  console.log('\n=== תוצאה: ' + (pass ? 'PASS ✓' : 'FAIL ✗') + ' (סה"כ ' + total + '/' + records.length + ', דליפות ' + leaks.length + ', שגיאות ' + errors.length + ') ===');
  process.exit(pass ? 0 : 1);
}

main();
