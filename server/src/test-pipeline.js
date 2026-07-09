/**
 * test-pipeline.js — מריץ את כל הצנרת על הדוח האמיתי בלי לשלוח אף מייל.
 *   reader -> classifier -> composer, ומדפיס סטטיסטיקת ניתוב + בדיקות שפיות.
 *
 * שימוש: node src/test-pipeline.js   (או npm run test:pipeline)
 * אפס תלות ב-LLM. אינו נוגע ב-DB ואינו שולח דואר.
 */
const fs = require('fs');
const path = require('path');
const { readReport } = require('./report/reader');
const { classify } = require('./report/classifier');
const { composeRelease } = require('./email/composer');
const imp = require('./db/importers');
const { REPORT_PATH, ROOT, config } = require('./config');

const EXT = config.external_email_override;
// נתיב הדוח: ארגומנט CLI > REPORT_PATH (config) > דגימה מקומית מצורפת.
// כשברירת המחדל היא נתיב פרודקשן ברשת (G:) שאינו נגיש בדיב — נופלים לדגימה
// המקומית ./data/ASDODAGENT.csv כדי ש-`npm run test:pipeline` יעבור בכל סביבה.
const LOCAL_SAMPLE = path.join(ROOT, 'data', 'ASDODAGENT.csv');
const TEST_REPORT_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : (fs.existsSync(REPORT_PATH) ? REPORT_PATH : LOCAL_SAMPLE);

function main() {
  const { records, headerRow } = readReport(TEST_REPORT_PATH);

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

      // בדיקת override: מסלולי ההעברה לחיפה (co_loader/terminal) נושאים כעת נמענים
      // אמיתיים במכוון (אושר 2026-07-07). prepaid/direct — עדיין override בלבד.
      const transferRoute = decision.route === 'co_loader' || decision.route === 'terminal';
      for (const to of mail.to) {
        extTo++;
        if (!transferRoute && to !== EXT) leaks.push({ file: rec.file_number, route: decision.route, to });
      }
      // ה-CC חייב להיות פנימי בלבד (אסור override שם) — בכל המסלולים
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
  console.log('דוח:', TEST_REPORT_PATH);
  console.log('שורת כותרות (0-based):', headerRow, '| שורות נתונים:', records.length);
  const withRelease = records.filter((r) => r.release_date).length;
  console.log('רשומות עם release_date:', withRelease + '/' + records.length,
    '| דוגמה:', records.find((r) => r.release_date)?.release_date || '—');

  // ---- משפך scope — raw -> LCL -> +נציג -> +19 לקוחות ההעברה לחיפה ----
  // אכיפת ה-whitelist ממקור האמת היחיד (scope.js) — אותה הגדרה כמו inScope וההגשה.
  const scope = require('./scope');
  const rs = config.report_scope || {};
  const nRep = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const isLcl = (r) => !rs.fcl_lcl || String(r.fcl_lcl || '').trim() === rs.fcl_lcl;
  const isRep = (r) => !rs.service_rep || nRep(r.service_rep) === nRep(rs.service_rep);
  const inScopeRec = (r) => isLcl(r) && isRep(r) && scope.isWhitelisted(r.customer_name);
  const cLcl = records.filter(isLcl).length;
  const cRep = records.filter((r) => isLcl(r) && isRep(r)).length;
  const scoped = records.filter(inScopeRec);
  console.log('\n--- משפך scope ---');
  console.log('  raw:', records.length, '| LCL:', cLcl, '| +נציג:', cRep, '| +19 לקוחות (inScope):', scoped.length);
  const scopedRoutes = {};
  for (const r of scoped) {
    const d = classify(r, imp.findByName(r.customer_name));
    scopedRoutes[d.route] = (scopedRoutes[d.route] || 0) + 1;
  }
  console.log('  ניתוב בתוך scope:', JSON.stringify(scopedRoutes));

  console.log('\n--- ניתוב לפי מסלול (כל הדוח) ---');
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
