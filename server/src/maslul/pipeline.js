/**
 * maslul/pipeline.js — תזמור הצנרת: PDF -> רסטר -> OCR -> פרסור -> זוג -> checksums
 * -> החרגות/מיפוי/ניקוי -> review.json. *אינו* מייצר xlsx (רק generate עושה זאת,
 * אחרי אישור אנושי).
 */
const fs = require('fs');
const path = require('path');
const jobs = require('./jobs');
const pdfRaster = require('./pdfRaster');
const invoiceOcr = require('./invoiceOcr');
const sanitizer = require('./sanitizer');
const { resolve: resolvePair } = require('./pairResolver');
const { buildRows } = require('./rulesEngine');
const checksums = require('./checksums');
const { cropRow } = require('./rowCrops');
const profiles = require('./profiles');
const templateInspector = require('./templateInspector');
const { writeRows } = require('./templateWriter');
const packageVerifier = require('./packageVerifier');

const PARSERS = { unilever_europe_v1: require('./invoiceParsers/unileverEuropeV1') };

const DEFAULT_PAIR_ID = 'unilever-europe__unilever-israel';

/** analyze — שלב הניתוח. מחזיר את מטען הסקירה ושומר אותו ב-review.json. */
async function analyze(jobId, { pdfPath, templatePath, pairId }) {
  const dir = jobs.jobDir(jobId);
  const setProgress = (stage, detail) => jobs.saveMeta(jobId, { status: 'analyzing', stage, stage_detail: detail || null });

  setProgress('raster', 'מרנדר עמודים');
  const raster = await pdfRaster.rasterize(pdfPath, path.join(dir, 'pages'), {
    onProgress: ({ page, total }) => setProgress('raster', `מרנדר עמוד ${page} מתוך ${total}`),
  });

  setProgress('ocr', 'מפענח טקסט');
  const ocrPages = [];
  for (const pg of raster.pages) {
    if (pg.blank) {
      console.log(`[maslul] דילוג על עמוד ריק ${pg.page} (${pg.bytes} bytes)`);
      ocrPages.push({ page: pg.page, blank: true, lines: [], text: '' });
      continue;
    }
    setProgress('ocr', `מפענח עמוד ${pg.page} מתוך ${raster.total}`);
    const r = await invoiceOcr.ocrPage(pg.file);
    ocrPages.push({ page: pg.page, blank: false, lines: r.lines, text: r.text });
  }
  jobs.writeJson(jobId, 'ocr.json', { pages: ocrPages.map((p) => ({ page: p.page, blank: p.blank, lines: p.lines })) });

  setProgress('parse', 'מפרסר שורות');
  const pair = resolvePair({
    supplierText: ocrPages.map((p) => p.text || '').join('\n'),
    pairId: pairId || DEFAULT_PAIR_ID,
  });
  if (!pair.ok) {
    const review = { job_id: jobId, blocked: true, errors: pair.errors, rows: [], excluded: [], guesses: [] };
    jobs.writeJson(jobId, 'review.json', review);
    jobs.saveMeta(jobId, { status: 'blocked', stage: 'pair', errors: pair.errors });
    return review;
  }
  const profile = pair.profile;

  const parser = PARSERS[profile.invoice_parser];
  if (!parser) throw Object.assign(new Error(`פרסר לא מוכר: ${profile.invoice_parser}`), { code: 'E01' });
  const parsed = parser.parse(ocrPages);
  jobs.writeJson(jobId, 'parsed.json', parsed);

  setProgress('checks', 'מאמת שורות');
  const rowChecks = checksums.checkRows(parsed.lines);
  const totals = checksums.checkTotals();

  const { rows, excluded, errors } = buildRows(parsed.lines, profile, rowChecks);

  // חיתוכי תמונה לכל שורה (לתצוגה במסך הסקירה) — נוחות בלבד, לא מפיל את הניתוח
  setProgress('crops', 'מכין תצוגות שורה');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const pagePng = path.join(dir, 'pages', `page-${r.page}.png`);
    const dest = path.join(dir, 'crops', `row-${i}.png`);
    const src = parsed.lines.find((l) => l.line_no === r.source_line);
    try {
      if (fs.existsSync(pagePng) && await cropRow(pagePng, r.bbox, src && src.bboxQty, dest)) r.crop = `row-${i}.png`;
    } catch (e) {
      console.warn(`[maslul] חיתוך שורה ${i} נכשל: ${e.message}`);
    }
  }

  // אימותי הסכומים בוטלו (ראו checksums.js) — נותרה רק חסימת חריגת 200 שורות
  const jobErrors = [...totals.errors];
  if (rows.length > 200) {
    jobErrors.push({ code: 'E08', message: `יותר מ-200 שורות אחרי החרגה (${rows.length})`, overridable: false });
  }
  const blockedRows = rows.filter((r) => r.blocked);

  const review = {
    job_id: jobId,
    pair_id: profile.pair_id,
    supplier: profile.supplier.name,
    importer: profile.importer,
    invoice_no: parsed.header.invoiceNo || null,
    template: path.basename(templatePath),
    rows,
    excluded,
    checksums: { rows: rowChecks, totals },
    row_errors: errors,
    errors: jobErrors,
    blocked: jobErrors.some((e) => !e.overridable) || blockedRows.length > 0,
    blocked_rows: blockedRows.length,
    guesses: rows.filter((r) => r.guess).map((r) => ({ sku: r.sku, ...r.guess })),
    pages: raster.pages.map((p) => ({ page: p.page, blank: p.blank })),
  };

  jobs.writeJson(jobId, 'review.json', review);
  jobs.saveMeta(jobId, {
    status: review.blocked ? 'blocked' : 'reviewing',
    stage: 'done',
    stage_detail: null,
    invoice_no: review.invoice_no,
    supplier: review.supplier,
    pair_id: review.pair_id,
    rows: rows.length,
    excluded: excluded.length,
    guesses: review.guesses.length,
    blocked_rows: blockedRows.length,
  });
  return review;
}

/**
 * generate — שלב ההפקה, רק אחרי אישור אנושי.
 * decisions: { approvals:[{sku,model}], manual:{ '<sku>': {B} } }
 */
async function generate(jobId, decisions = {}) {
  const dir = jobs.jobDir(jobId);
  const review = jobs.readJson(jobId, 'review.json');
  if (!review) throw Object.assign(new Error('לא נמצאה סקירה לריצה זו'), { status: 404 });

  const meta = jobs.readJson(jobId, 'job.json') || {};
  const templatePath = path.join(dir, 'template.xlsx');

  // 1. אימות מחדש מול הפרופיל וההחלטות
  // אימותי הסכומים (E11/E12) בוטלו — ריצות ישנות שנחסמו בגללם ניתנות להפקה מחדש
  const errors = [];

  const manual = decisions.manual || {};
  const rows = review.rows.map((r) => {
    const out = { ...r, status: { ...r.status } };
    const m = manual[r.sku];
    if (m && m.B != null) {
      const v = sanitizer.validateB(m.B);
      if (v.ok) { out.B = v.value; out.status.B = 'verified'; }
      else errors.push({ code: v.code, sku: r.sku, message: v.message });
    }
    return out;
  });

  for (const r of rows) {
    for (const [col, st] of Object.entries(r.status)) {
      if (st === 'blocked') {
        errors.push({ code: 'E06', sku: r.sku, message: `שורה ${r.sku}: עמודה ${col} חסומה — לא ניתן להפיק` });
      }
    }
  }
  if (errors.length) {
    jobs.saveMeta(jobId, { status: 'blocked' });
    return { ok: false, errors };
  }

  // 2. קידום ניחושים שאושרו — כתיבה אטומית אחת
  let promoted = [];
  if ((decisions.approvals || []).length) {
    promoted = profiles.promoteGuesses(review.pair_id, decisions.approvals, review.invoice_no).promoted;
  }

  // 3. אימות מבנה התבנית — גם ברירת המחדל
  const inspection = templateInspector.inspect(templatePath);
  if (!inspection.ok) {
    jobs.saveMeta(jobId, { status: 'blocked' });
    return { ok: false, errors: inspection.errors };
  }

  // 4. כתיבה כירורגית
  const planned = rows.map((r) => ({ A: r.A, B: r.B, C: r.C, D: r.D, E: r.E, F: r.F, G: r.G }));
  let buf;
  try {
    buf = writeRows(inspection, planned).buf;
  } catch (e) {
    jobs.saveMeta(jobId, { status: 'blocked' });
    return { ok: false, errors: [{ code: e.code || 'E09', message: e.message }] };
  }

  // 5. אימות ה-package — כשל => הקובץ לא נמסר
  const ver = packageVerifier.verify(inspection.buf, buf, planned);
  if (!ver.ok) {
    jobs.saveMeta(jobId, { status: 'blocked' });
    return { ok: false, errors: ver.errors };
  }

  // 6. שמירה. שם הפלט = שם התבנית.
  const outDir = path.join(dir, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outName = meta.template_name || path.basename(templatePath);
  fs.writeFileSync(path.join(outDir, outName), buf);

  jobs.writeJson(jobId, 'decisions.json', { ...decisions, promoted, generated_at: new Date().toISOString() });
  jobs.saveMeta(jobId, { status: 'generated', output: outName, promoted: promoted.length });

  return { ok: true, output: outName, rows: planned.length, promoted };
}

module.exports = { analyze, generate, PARSERS, DEFAULT_PAIR_ID };
