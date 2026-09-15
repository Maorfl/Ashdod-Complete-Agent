/**
 * test-maslul.js — חבילת הבדיקות של מחולל קבצי הייבוא למסלול.
 * הרצה: npm run test:maslul  (מתוך server/)
 *
 * כולל: Golden (חובה), תרגול פרסר על שני חשבונות נוספים, בדיקות יחידה,
 * ובדיקות שלילה (כולן חייבות להסתיים בעצירה ללא קובץ).
 * אינו שולח דבר ואינו נוגע בשאר המערכת.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');

const sanitizer = require('./maslul/sanitizer');
const rules = require('./maslul/rulesEngine');
const checksums = require('./maslul/checksums');
const templateInspector = require('./maslul/templateInspector');
const { writeRows } = require('./maslul/templateWriter');
const packageVerifier = require('./maslul/packageVerifier');
const zipRaw = require('./maslul/zipRaw');
const pdfRaster = require('./maslul/pdfRaster');
const invoiceOcr = require('./maslul/invoiceOcr');
const parser = require('./maslul/invoiceParsers/unileverEuropeV1');
const { resolve: resolvePair } = require('./maslul/pairResolver');
const profiles = require('./maslul/profiles');

const FIX = path.join(__dirname, '..', 'test', 'fixtures', 'maslul');
const SHEET_NAME = 'תבנית ליבוא נתונים למסלול';

let pass = 0; let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function eq(name, actual, expected) {
  check(name, actual === expected, `צפוי ${JSON.stringify(expected)}, התקבל ${JSON.stringify(actual)}`);
}
function section(t) { console.log(`\n--- ${t} ---`); }

/** OCR + פרסור של חשבון — משותף ל-Golden ולתרגולי הפרסר. */
async function parseInvoice(pdfName) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maslul-test-'));
  const raster = await pdfRaster.rasterize(path.join(FIX, pdfName), tmp);
  const pages = [];
  for (const pg of raster.pages) {
    if (pg.blank) { pages.push({ page: pg.page, blank: true, lines: [], text: '' }); continue; }
    const r = await invoiceOcr.ocrPage(pg.file);
    pages.push({ page: pg.page, blank: false, lines: r.lines, text: r.text });
  }
  const parsed = parser.parse(pages);
  return { parsed, raster, tmp };
}

async function testGolden() {
  section('Golden — חשבון 7113487000 מול הפלט המאושר (בקשה 10118471)');
  const { parsed } = await parseInvoice('invoice_7113487000.pdf');

  eq('נפרסרו 8 שורות פריט', parsed.lines.length, 8);
  eq('Total Number of Cases נקרא', parsed.totals.cases, 10661);
  eq('Total Material Value נקרא', parsed.totals.value, 37105.08);

  // האימותים האריתמטיים בוטלו — נותרו קוד Commodity ו-EAN-13 בלבד
  const rowChecks = checksums.checkRows(parsed.lines);
  check('אימותי שורה (Commodity/EAN) עוברים', rowChecks.every((c) => c.ok),
    JSON.stringify(rowChecks.filter((c) => !c.ok).map((c) => c.issues)));

  const pair = resolvePair({ supplierText: 'unilever europe bv' });
  check('זוהה פרופיל הזוג', pair.ok === true);

  const { rows, excluded } = rules.buildRows(parsed.lines, pair.profile, rowChecks);
  eq('7 שורות אחרי החרגה', rows.length, 7);
  eq('שורה אחת הוחרגה', excluded.length, 1);
  eq('המוחרג הוא 65436712 (RO 50ML)', excluded[0] && excluded[0].sku, '65436712');

  // הדרישה המפורשת: ה-Golden עובר עם אפס ניחושים
  const guesses = rows.filter((r) => r.guess);
  eq('אפס ניחושים ב-Golden', guesses.length, 0);
  check('כל התאים מאומתים', rows.every((r) => ['A', 'B', 'C', 'D', 'E', 'F'].every((c) => r.status[c] === 'verified')));

  // כתיבה + אימות package
  const templatePath = path.join(FIX, 'template_empty.xlsx');
  const ins = templateInspector.inspect(templatePath);
  check('התבנית עוברת את האינספקטור', ins.ok === true, JSON.stringify(ins.errors));
  const planned = rows.map((r) => ({ A: r.A, B: r.B, C: r.C, D: r.D, E: r.E, F: r.F, G: r.G }));
  const { buf } = writeRows(ins, planned);
  const ver = packageVerifier.verify(ins.buf, buf, planned);
  check('אימות ה-package עובר', ver.ok === true, JSON.stringify(ver.errors));

  // השוואה תא-אחר-תא מול הפלט הצפוי, כולל שורות 11-203 שחייבות להישאר כמו בתבנית
  const expected = XLSX.readFile(path.join(FIX, 'expected_7113487000.xlsx')).Sheets[SHEET_NAME];
  const got = XLSX.read(buf, { type: 'buffer' }).Sheets[SHEET_NAME];
  let diffs = 0; const sample = [];
  for (let r = 4; r <= 203; r++) {
    for (const c of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      const a = expected[c + r]; const b = got[c + r];
      const av = a ? String(a.v) : ''; const bv = b ? String(b.v) : '';
      if (av !== bv) { diffs++; if (sample.length < 5) sample.push(`${c}${r}: ${JSON.stringify(av)} != ${JSON.stringify(bv)}`); }
    }
  }
  eq('התאמה מדויקת לפלט הצפוי (A4:G203)', diffs, 0);
  if (diffs) console.log('    ' + sample.join('\n    '));

  // G ריק בכל השורות
  check('עמודה G ריקה', [4, 5, 6, 7, 8, 9, 10].every((r) => !got['G' + r]));
}

async function testParserExercise() {
  section('תרגול פרסר — 7113482802 (מספור לא רציף) ו-7113482826');
  const pair = resolvePair({ supplierText: 'unilever europe bv' });

  for (const [pdf, label] of [['invoice_7113482802.pdf', '7113482802'], ['invoice_7113482826.pdf', '7113482826']]) {
    const { parsed } = await parseInvoice(pdf);
    check(`${label}: נפרסרו שורות`, parsed.lines.length > 0, `${parsed.lines.length}`);
    const rowChecks = checksums.checkRows(parsed.lines);
    check(`${label}: אימותי שורה (Commodity/EAN)`, rowChecks.every((c) => c.ok),
      JSON.stringify(rowChecks.filter((c) => !c.ok).map((c) => ({ sku: c.sku, issues: c.issues }))));

    if (label === '7113482802') {
      const nums = parsed.lines.map((l) => l.item_no);
      check('מספור פריטים לא רציף נשמר כתווית', nums.includes('000010') && nums.includes('000030'), nums.join(','));
    }

    const { rows, excluded } = rules.buildRows(parsed.lines, pair.profile, rowChecks);
    const has65223277 = parsed.lines.some((l) => l.sku === '65223277');
    if (has65223277) {
      check(`${label}: 65223277 (RO50ML) הוחרג`, excluded.some((e) => e.sku === '65223277'));
    }

    // ההפרש המתועד מול קבצי הייחוס 04/05: שורת 65228009
    const r65228009 = rows.find((r) => r.sku === '65228009');
    if (r65228009) {
      eq(`${label}: 65228009 = ערך בן 27 תווים מהמפרט`, r65228009.B, 'DFW AP 150ML CCNT JSMN FLWR');
      // אושר ע"י המשתמש ב-2026-09-15 (approved_from_invoice: 7113482802) ולכן verified
      check(`${label}: 65228009 מאומת לאחר אישור`, r65228009.status.B === 'verified');
    }
  }
}

function testUnits() {
  section('בדיקות יחידה — sanitizer / fmtNum / החרגה / escape / EAN / מספרים אירופיים');

  // sanitizer — תווים בלתי נראים
  eq('NBSP מוסר', sanitizer.clean('A B'), 'A B');
  eq('LRM/RLM מוסרים', sanitizer.clean('A‎B‏C'), 'A B C');
  eq('ZWSP מוסר', sanitizer.clean('A​B'), 'A B');
  eq('BOM מוסר', sanitizer.clean('﻿ABC'), 'ABC');
  eq('TAB/CR/LF מוסרים', sanitizer.clean('A\tB\r\nC'), 'A B C');
  eq('רווחים כפולים מכווצים', sanitizer.clean('A   B'), 'A B');
  eq('trim', sanitizer.clean('  AB  '), 'AB');

  // אורכים גבוליים
  check('A באורך 12 תקין', sanitizer.validateA('3307200000/4').ok === true);
  check('A באורך 11 נפסל', sanitizer.validateA('330720000/4').ok === false);
  check('B באורך 35 תקין', sanitizer.validateB('X'.repeat(35)).ok === true);
  check('B באורך 36 נפסל', sanitizer.validateB('X'.repeat(36)).ok === false);
  check('B עם עברית נפסל', sanitizer.validateB('מוצר').ok === false);
  check('C באורך 140 תקין', sanitizer.validateC('א'.repeat(140)).ok === true);
  check('C באורך 141 נפסל', sanitizer.validateC('א'.repeat(141)).ok === false);

  // fmtNum
  eq('fmtNum 1000', sanitizer.fmtNum(1000), '1000');
  eq('fmtNum 2688', sanitizer.fmtNum(2688), '2688');
  eq('fmtNum 12.5', sanitizer.fmtNum(12.5), '12.5');
  eq('fmtNum 0.10 -> 0.1', sanitizer.fmtNum('0.10'), '0.1');
  let threw = false; try { sanitizer.fmtNum(12.345); } catch { threw = true; }
  check('fmtNum 12.345 זורק', threw);
  threw = false; try { sanitizer.fmtNum(-1); } catch { threw = true; }
  check('fmtNum שלילי זורק', threw);
  check('fmtNum ללא כתיב מדעי', !sanitizer.fmtNum(1e6).includes('e'));

  // החרגת 50ML
  const re = new RegExp('(?<!\\d)50ML', 'i');
  check('RO50ML מוחרג', re.test('RFW AP RO50ML X') === true);
  check('RO 50ML מוחרג', re.test('RFW AP RO 50ML X') === true);
  check('150ML אינו מוחרג', re.test('RFM AP 150ML ICED') === false);
  // תיעוד התנהגות בפועל: ה-lookbehind חוסם כל ספרה, ולכן 250ML אינו מוחרג
  check('250ML אינו מוחרג (lookbehind חוסם ספרה)', re.test('X 250ML') === false);

  // XML escape
  eq('escape &', sanitizer.xmlEscape('A & B'), 'A &amp; B');
  eq('escape < >', sanitizer.xmlEscape('<x>'), '&lt;x&gt;');

  // מספרים אירופיים
  eq('2.688 -> 2688', sanitizer.parseEuroNumber('2.688'), 2688);
  eq('1.715,27 -> 1715.27', sanitizer.parseEuroNumber('1.715,27'), 1715.27);
  eq('10.661 -> 10661', sanitizer.parseEuroNumber('10.661'), 10661);
  eq('0,00 -> 0', sanitizer.parseEuroNumber('0,00'), 0);

  // EAN-13
  check('EAN תקין', sanitizer.validateEan13('8720181820335') === true);
  check('EAN עם ספרת ביקורת שגויה', sanitizer.validateEan13('8720181820336') === false);

  // guess algorithm
  const g = rules.guessUnileverV1('DFW AP 150ML CCNT JSMN FLWR SCNT DAPHNE BE');
  check('ניחוש מסיר סיומות אתר/אצווה', g.removedTokens.length > 0, JSON.stringify(g));
  check('ניחוש <= 35 תווים', g.value.length <= 35, `${g.value.length}: ${g.value}`);

  // קוד דגם מספרי נכתב כטקסט (inlineStr)
  const ins = templateInspector.inspect(path.join(FIX, 'template_empty.xlsx'));
  const numericModel = [{ A: '3307200000/4', B: '1002843.1', C: 'בדיקה', D: 1, E: 1, F: 1 }];
  const out = writeRows(ins, numericModel);
  check('קוד דגם מספרי נכתב כ-inlineStr', /<c r="B4"[^>]*t="inlineStr"><is><t>1002843\.1<\/t><\/is><\/c>/.test(out.xml));
  check('מספר נכתב ללא t', /<c r="D4"[^>]*><v>1<\/v><\/c>/.test(out.xml));

  // escape בפועל בכתיבה
  const amp = writeRows(ins, [{ A: '3307200000/4', B: 'A & B', C: 'x', D: 1, E: 1, F: 1 }]);
  check('& עובר escape בכתיבה', amp.xml.includes('<t>A &amp; B</t>'));

  // תא ריק לא נכתב כלל
  check('תא ריק נשאר כבתבנית', /<c r="G4" s="28"\/>/.test(amp.xml));

  // שימור ה-s לפי תא (לא אחיד בין שורות)
  eq('s של A4 נשמר', ins.styles.A4, 's="24"');
  eq('s של A5 שונה מ-A4', ins.styles.A5, 's="11"');
  eq('s של C8 שונה מ-C5', ins.styles.C8, 's="4"');
}

function testNegative() {
  section('בדיקות שלילה — כולן חייבות לעצור ללא קובץ');
  const ins = templateInspector.inspect(path.join(FIX, 'template_empty.xlsx'));

  // 201 שורות
  let threw = null;
  try {
    writeRows(ins, Array.from({ length: 201 }, () => ({ A: '3307200000/4', B: 'X', C: 'y', D: 1, E: 1, F: 1 })));
  } catch (e) { threw = e; }
  check('201 שורות נעצרות (E08)', threw && threw.code === 'E08', threw ? threw.message : 'לא נזרקה שגיאה');

  // קוד דגם 36 תווים
  check('קוד דגם בן 36 תווים נפסל', sanitizer.validateB('X'.repeat(36)).ok === false);

  // ספק לא מוכר
  const unknown = resolvePair({ supplierText: 'SOME OTHER SUPPLIER LTD', pairId: null });
  check('ספק לא מוכר => E01', unknown.ok === false && unknown.errors[0].code === 'E01');

  // HS לא ממופה
  const profile = profiles.getProfile('unilever-europe__unilever-israel');
  const badHs = rules.buildRows(
    [{ line_no: 1, sku: '65223592', description: 'RFM AP 150ML ICED LEMON SAGE', hs_code: '99999999', qty_in_zun: 100, qty_cs: 1 }],
    profile, [],
  );
  check('HS לא ממופה => E04 וחסימה', badHs.errors.some((e) => e.code === 'E04') && badHs.rows[0].blocked === true);

  // אי-התאמה אריתמטית אינה חוסמת עוד (בוטל לפי החלטת המשתמש) — מחיר שגוי עובר
  const brokenRow = checksums.checkRows([{ sku: 'x', item_no: '1', qty_in_zun: 2688, unit_price_per_1000: 638.12, value_eur: 9999, hs_code: '33072000', ean: null }]);
  check('אי-התאמה אריתמטית אינה חוסמת', brokenRow[0].ok === true);

  // EAN-13 שגוי עדיין נתפס (אינו תלוי במחיר)
  const badEan = checksums.checkRows([{ sku: 'x', item_no: '1', hs_code: '33072000', ean: '8720181820336' }]);
  check('EAN-13 שגוי => E07', badEan[0].ok === false && badEan[0].issues.some((i) => i.code === 'E07'));

  // checkTotals בוטל — לעולם אינו מחזיר שגיאות
  check('סכומים אינם מחזירים שגיאות', checksums.checkTotals().errors.length === 0);

  // תבנית פגומה (חסר dataValidation) => E03
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maslul-neg-'));
  const tplBuf = fs.readFileSync(path.join(FIX, 'template_empty.xlsx'));
  const entries = zipRaw.readEntries(tplBuf);
  const sheetEntry = entries.find((e) => e.name === templateInspector.SHEET);
  const xml = zipRaw.readData(tplBuf, sheetEntry).toString('utf8');
  const brokenXml = xml.replace(/<dataValidation [^>]*sqref="B4:B203"[\s\S]*?<\/dataValidation>/, '');
  const brokenBuf = zipRaw.writeZip(tplBuf, entries, { [templateInspector.SHEET]: Buffer.from(brokenXml, 'utf8') });
  const brokenPath = path.join(tmp, 'broken.xlsx');
  fs.writeFileSync(brokenPath, brokenBuf);
  const brokenIns = templateInspector.inspect(brokenPath);
  check('תבנית עם dataValidation חסר => E03',
    brokenIns.ok === false && brokenIns.errors.some((e) => e.code === 'E03'),
    JSON.stringify(brokenIns.errors && brokenIns.errors.slice(0, 2)));

  // אימות package נכשל כשמשנים קובץ אחר ב-package
  const tampered = zipRaw.writeZip(tplBuf, entries, { 'xl/sharedStrings.xml': Buffer.from('<x/>', 'utf8') });
  const verTampered = packageVerifier.verify(tplBuf, tampered, []);
  check('שינוי קובץ אחר ב-package => E09', verTampered.ok === false && verTampered.errors[0].code === 'E09');
}

/** אימות קלט ההעלאה — סיומת *וגם* חתימת %PDF-, בצד השרת (לא ה-accept של הדפדפן). */
async function testUploadValidation() {
  section('אימות העלאה (HTTP) — קבצים פסולים נדחים בצד השרת');
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/maslul', require('./routes/maslul'));

  await new Promise((done) => {
    const srv = app.listen(0, async () => {
      const base = `http://127.0.0.1:${srv.address().port}/api/maslul`;
      const post = async (bytes, fname) => {
        const fd = new FormData();
        fd.append('invoice', new Blob([bytes], { type: 'application/pdf' }), fname);
        const r = await fetch(`${base}/jobs`, { method: 'POST', body: fd });
        return { status: r.status, body: await r.json() };
      };
      try {
        const garbage = await post(Buffer.from('not a pdf at all'), 'x.pdf');
        check('קובץ שאינו PDF (למרות סיומת/mimetype) נדחה', garbage.status === 400 && garbage.body.code === 'E02',
          `status ${garbage.status}`);

        const realPdfWrongExt = await post(fs.readFileSync(path.join(FIX, 'invoice_7113487000.pdf')).slice(0, 2000), 'x.txt');
        check('PDF עם סיומת שאינה .pdf נדחה', realPdfWrongExt.status === 400 && realPdfWrongExt.body.code === 'E02',
          `status ${realPdfWrongExt.status}`);

        // העלאת תבנית בוטלה — שדה 'template' נדחה בנקייה כ-JSON (ולא כדף HTML של Express)
        const fd = new FormData();
        fd.append('invoice', new Blob([fs.readFileSync(path.join(FIX, 'invoice_7113487000.pdf'))], { type: 'application/pdf' }), 'i.pdf');
        fd.append('template', new Blob([Buffer.from('not a zip')]), 't.xlsx');
        const badTpl = await fetch(`${base}/jobs`, { method: 'POST', body: fd });
        const ct = String(badTpl.headers.get('content-type') || '');
        check('שדה template נדחה כ-JSON ולא כ-HTML', badTpl.status === 400 && ct.includes('application/json'),
          `status ${badTpl.status}, content-type ${ct}`);
        const badTplBody = await badTpl.json();
        check('שדה template נדחה => E02', badTplBody.code === 'E02', JSON.stringify(badTplBody));

        // מחיקה: ריצה שנוצרה נמחקת, ומזהה עם traversal נדחה
        const mk = await post(fs.readFileSync(path.join(FIX, 'invoice_7113487000.pdf')), 'i.pdf');
        check('העלאה תקינה מחזירה 202', mk.status === 202 && !!mk.body.job_id, `status ${mk.status}`);
        const del = await fetch(`${base}/jobs/${mk.body.job_id}`, { method: 'DELETE' });
        check('מחיקת ריצה מחזירה ok', del.status === 200, `status ${del.status}`);
        const delBad = await fetch(`${base}/jobs/..%2f..`, { method: 'DELETE' });
        check('מחיקה עם traversal נדחית', delBad.status === 400 || delBad.status === 404, `status ${delBad.status}`);
      } catch (e) {
        check('בדיקות ההעלאה רצו', false, e.message);
      } finally {
        srv.close(done);
      }
    });
  });
}

/**
 * פורמט מספרים — חשבונות Unilever מגיעים גם בפורמט אירופי (1.715,27) וגם
 * בפורמט אנגלי (43,740.85). פענוח בפורמט השגוי אינו נכשל אלא מחזיר מספר
 * שגוי פי 1000, ולכן הזיהוי האוטומטי נבדק בשני הכיוונים.
 */
function testNumberFormat() {
  section('פורמט מספרים — זיהוי אוטומטי');
  const { parseNumber, detectNumberFormat } = require('./maslul/sanitizer');

  const anglo = '000010 65634626 AXE BS 150ML 33072000 8720181663574\n'
    + '11,284 CS 67,704 ZUN 43,740.85 0.00 646.060 EUR per 1000 ZUN 43,740.85 0.00 % 0.00';
  const eu = '000010 65223592 RFM AP 150ML 33072000 8720181820335\n'
    + '448 CS 2.688 ZUN 1.715,27 0,00 638,120 EUR per 1000 ZUN 1.715,27 0,00 % 0,00';

  check('זוהה פורמט אנגלי', detectNumberFormat(anglo) === 'anglo');
  check('זוהה פורמט אירופי', detectNumberFormat(eu) === 'eu');

  check('אנגלי: 43,740.85 -> 43740.85', parseNumber('43,740.85', 'anglo') === 43740.85);
  check('אנגלי: 67,704 -> 67704', parseNumber('67,704', 'anglo') === 67704);
  check('אנגלי: 646.060 -> 646.06', parseNumber('646.060', 'anglo') === 646.06);
  check('אירופי: 1.715,27 -> 1715.27', parseNumber('1.715,27', 'eu') === 1715.27);
  check('אירופי: 2.688 -> 2688', parseNumber('2.688', 'eu') === 2688);
  check('אירופי: 638,120 -> 638.12', parseNumber('638,120', 'eu') === 638.12);

  // מספר תקין בפורמט אחד אינו תקין באחר — שומר על הפרדה חדה בין השניים
  check('אירופי דוחה 43,740.85', parseNumber('43,740.85', 'eu') === null);
  check('אנגלי דוחה 1.715,27', parseNumber('1.715,27', 'anglo') === null);

  // הפרסר על שורת אנגלית מלאה: D=ZUN, והאינווריאנטה מתקיימת
  const parser = require('./maslul/invoiceParsers/unileverEuropeV1');
  const toLines = (t) => t.split('\n').map((x) => ({ text: x, bbox: null }));
  const r = parser.parse([{ page: 1, lines: toLines(anglo) }]);
  check('פרסר: זוהה anglo', r.numFormat === 'anglo');
  check('פרסר: כמות D נלקחת מ-ZUN', r.lines[0] && r.lines[0].qty_in_zun === 67704);
  check('פרסר: ארגזים מ-CS', r.lines[0] && r.lines[0].qty_cs === 11284);
  check('פרסר: מחיר ליחידה 646.06', r.lines[0] && r.lines[0].unit_price_per_1000 === 646.06);
  check('פרסר: ערך שורה 43740.85', r.lines[0] && r.lines[0].value_eur === 43740.85);
  check(
    'פרסר: אינווריאנטה מתקיימת בפורמט אנגלי',
    r.lines[0] && Math.abs((r.lines[0].qty_in_zun * r.lines[0].unit_price_per_1000) / 1000 - r.lines[0].value_eur) < 0.011
  );
}

(async () => {
  console.log('=== בדיקות מחולל מסלול ===');
  try {
    testUnits();
    testNumberFormat();
    testNegative();
    await testUploadValidation();
    await testGolden();
    await testParserExercise();
  } catch (e) {
    fail++; failures.push('חריגה לא צפויה');
    console.error('\nחריגה:', e.stack);
  } finally {
    await invoiceOcr.shutdown();
  }
  console.log(`\n=== סיכום: ${pass} עברו, ${fail} נכשלו ===`);
  if (fail) {
    console.log('נכשלו:'); failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('PASS ✓');
})();
