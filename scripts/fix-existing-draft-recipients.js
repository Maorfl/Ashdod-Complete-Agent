/**
 * fix-existing-draft-recipients.js — תיקון חד-פעמי (2026-07-07, אישור משתמש מפורש).
 *
 * ⚠⚠ עוקף במכוון את external_email_override עבור רשומות קיימות בלבד ⚠⚠
 * כותב את כתובות המייל האמיתיות (מ-importer.json / co_loaders.json / terminals.json)
 * לתוך draft_payload.email.to של טיוטות שכבר ב-DB. משמעות: אישור טיוטה כזו ישלח
 * מייל אמיתי לנמען אמיתי — לא ל-override. זה מאושר ומכוון.
 *
 * לא נוגע ב-classifier/routeExternal — קליטה חדשה ממשיכה לנתב דרך ה-override.
 * הפתרון לכל תיק: קריאת הדוח הנוכחי + classify מחדש (שימוש חוזר בלוגיקה הקיימת),
 * ואז מיפוי ה-route לכתובות האמיתיות מן ה-config. תיק ללא כתובת אמיתית — לא משתנה.
 *
 * הרצה יבשה כברירת מחדל; --apply לכתיבה. כל שינוי מתועד before/after לביקורת.
 * שימוש: node scripts/fix-existing-draft-recipients.js [--apply]
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const shipments = require(path.join(ROOT, 'server', 'src', 'db', 'shipments'));
const importersDb = require(path.join(ROOT, 'server', 'src', 'db', 'importers'));
const { readReport } = require(path.join(ROOT, 'server', 'src', 'report', 'reader'));
const { classify } = require(path.join(ROOT, 'server', 'src', 'report', 'classifier'));
const { config, coLoaders, terminals, REPORT_PATH } = require(path.join(ROOT, 'server', 'src', 'config'));

const APPLY = process.argv.includes('--apply');
const OVERRIDE = config.external_email_override;
const ACTIONABLE = new Set(['pending_approval', 'awaiting_gatepass']);

// אותו נרמול מפתח מסוף כמו במסווג (רווחים כפולים -> יחיד)
const normKey = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const terminalsNorm = {};
for (const [k, v] of Object.entries(terminals)) terminalsNorm[normKey(k)] = v;

// כתובות אמיתיות בלבד — מסנן את ה-override עצמו אם עדיין שמור איפשהו
const real = (arr) => (arr || []).filter((e) => e && e.includes('@') && e !== OVERRIDE);

function resolveRealTo(route, { coLoaderCode, site, importer }) {
  if (route === 'co_loader') return real(coLoaders[coLoaderCode]?.emails);
  if (route === 'terminal') {
    const term = terminals[site] || terminalsNorm[normKey(site)];
    return real(term?.emails);
  }
  // prepaid / direct — היבואן עצמו
  return real(importer?.emails);
}

function main() {
  const { records } = readReport(REPORT_PATH);
  const byFile = new Map(records.map((r) => [r.file_number, r]));

  const targets = shipments.all().filter((s) => ACTIONABLE.has(s.status));
  console.log('=== fix-existing-draft-recipients', APPLY ? '(APPLY)' : '(DRY-RUN)', '===');
  console.log('דוח:', REPORT_PATH, '| טיוטות פעילות:', targets.length);
  console.log('⚠ פעולה זו כותבת נמענים אמיתיים לטיוטות קיימות — אישורן ישלח מייל אמיתי.\n');

  let fixed = 0, skipped = 0;
  for (const s of targets) {
    let payload;
    try { payload = s.draft_payload ? JSON.parse(s.draft_payload) : null; } catch { payload = null; }
    if (!payload?.email) { skipped += 1; console.log(`  ${s.file_number}  — דילוג: אין טיוטת מייל`); continue; }

    // מקור הפתרון: הדוח החי אם התיק בו; אחרת — נתוני השורה עצמה (route/
    // co_loader_code/transfer_performer שנשמרו בקליטה). הדוח ב-G: מתרענן כל כמה
    // דקות ותכולתו משתנה, ולכן אי-הימצאות בו אינה סיבה לדלג.
    const rec = byFile.get(String(s.file_number));
    const importer = importersDb.findByName(rec?.customer_name || s.customer_name);
    let route, coLoaderCode, site;
    if (rec) {
      const decision = classify(rec, importer);
      route = decision.route;
      coLoaderCode = decision.handler?.code;
      site = decision.handler?.site;
    } else {
      route = s.route;
      coLoaderCode = s.co_loader_code;
      site = s.transfer_performer; // במסלול terminal זהו בדיוק Cust. Stor. Site Des
    }
    const realTo = resolveRealTo(route, { coLoaderCode, site, importer });
    if (!realTo.length) { skipped += 1; console.log(`  ${s.file_number}  — דילוג: אין כתובת אמיתית רשומה (${route})`); continue; }

    const before = payload.email.to || [];
    console.log(`  ${s.file_number}  ${(s.customer_name || '').slice(0, 30)}  [${route}${rec ? '' : ', מנתוני השורה'}]`);
    console.log(`     לפני : ${JSON.stringify(before)}`);
    console.log(`     אחרי : ${JSON.stringify(realTo)}`);

    if (APPLY) {
      payload.email.to = realTo; // CC נשאר — פנימי (מחלקה) וכבר אמיתי
      shipments.upsert({ file_number: s.file_number, draft_payload: payload });
      shipments.addHistory(s.file_number, s.status, `נמעני הטיוטה עודכנו לכתובות אמיתיות: ${realTo.join(', ')}`);
    }
    fixed += 1;
  }

  console.log(`\n${APPLY ? 'עודכנו' : 'יעודכנו'}: ${fixed} | דילוגים: ${skipped}`);
  if (!APPLY) console.log('(הרצה יבשה — לא נכתב דבר. להרצה בפועל: --apply)');
}

main();
