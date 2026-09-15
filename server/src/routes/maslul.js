/**
 * routes/maslul.js — API של מחולל קבצי הייבוא למסלול (מכון התקנים).
 *
 * מבודד לחלוטין משאר המערכת: אינו שולח מייל, אינו נוגע ב-shipments/approvals,
 * וכותב רק תחת config/maslul/ ו-data/maslul/.
 *
 * העלאה: multer בזיכרון על המסלול הזה בלבד — גבול ה-JSON הגלובלי (5MB) לא משתנה.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const jobs = require('../maslul/jobs');
const pipeline = require('../maslul/pipeline');
const profiles = require('../maslul/profiles');

const router = express.Router();

const MAX_PDF_MB = 25;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_MB * 1024 * 1024 },
});

/**
 * אימות PDF בצד השרת: חתימת %PDF- *וגם* סיומת .pdf — לא סומכים על ה-mimetype
 * שהדפדפן שלח (ניתן לזיוף) ולא על ה-accept של בורר הקבצים.
 */
function isPdf(buf, originalname) {
  const magicOk = buf.slice(0, 5).toString('latin1') === '%PDF-';
  const extOk = /\.pdf$/i.test(String(originalname || ''));
  return magicOk && extOk;
}

/** POST /api/maslul/jobs — העלאה + ניתוח (ללא הפקת קובץ). */
router.post('/jobs', upload.fields([{ name: 'invoice', maxCount: 1 }]), async (req, res) => {
  const invoice = (req.files && req.files.invoice && req.files.invoice[0]) || null;

  if (!invoice || !invoice.buffer?.length) {
    return res.status(400).json({ error: 'לא צורף חשבון ספק (PDF)', code: 'E02' });
  }
  if (!isPdf(invoice.buffer, invoice.originalname)) {
    return res.status(400).json({ error: `הקובץ אינו PDF תקין (נדרשת סיומת .pdf וחתימת %PDF-). גודל מרבי ${MAX_PDF_MB}MB.`, code: 'E02' });
  }
  if (invoice.buffer.length > MAX_PDF_MB * 1024 * 1024) {
    return res.status(400).json({ error: `החשבון גדול מהמותר (${MAX_PDF_MB}MB)`, code: 'E02' });
  }

  const { id, dir } = jobs.createJob();
  const pdfPath = path.join(dir, 'invoice.pdf');
  const templatePath = path.join(dir, 'template.xlsx');
  fs.writeFileSync(pdfPath, invoice.buffer);

  // תמיד התבנית המובנית — אין העלאת תבנית מהמסך. היא נבדקת שוב בשלב ההפקה.
  const templateName = path.basename(profiles.DEFAULT_TEMPLATE);
  fs.copyFileSync(profiles.DEFAULT_TEMPLATE, templatePath);

  jobs.saveMeta(id, {
    created_at: new Date().toISOString(),
    status: 'analyzing',
    invoice_name: invoice.originalname,
    template_name: templateName,
    template_source: 'default',
  });

  // הניתוח רץ ברקע; הלקוח מושך התקדמות דרך GET /jobs/:id
  res.status(202).json({ job_id: id, status: 'analyzing' });

  pipeline.analyze(id, { pdfPath, templatePath }).catch((e) => {
    // הריצה נמחקה בזמן הניתוח — נטישה לגיטימית, לא שגיאה
    if (!fs.existsSync(dir)) {
      console.log(`[maslul] הניתוח של ${id} הופסק — הריצה נמחקה`);
      return;
    }
    console.error('[maslul] ניתוח נכשל:', e);
    jobs.saveMeta(id, { status: 'error', error: e.message, code: e.code || null });
  });
});

/** GET /api/maslul/jobs — היסטוריית ריצות (החדשה ראשונה). */
router.get('/jobs', (req, res) => {
  res.json(jobs.listJobs());
});

/** GET /api/maslul/jobs/:id — מטא + מטען הסקירה המלא. */
router.get('/jobs/:id', (req, res) => {
  try {
    const meta = jobs.readJson(req.params.id, 'job.json');
    if (!meta) return res.status(404).json({ error: 'ריצה לא נמצאה' });
    res.json({ ...meta, review: jobs.readJson(req.params.id, 'review.json') });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** POST /api/maslul/jobs/:id/generate — הפקה בפועל, רק אחרי אישור אנושי. */
router.post('/jobs/:id/generate', async (req, res) => {
  try {
    const result = await pipeline.generate(req.params.id, req.body || {});
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code || null });
  }
});

/** GET /api/maslul/jobs/:id/output — הורדת הקובץ שהופק. */
router.get('/jobs/:id/output', (req, res) => {
  try {
    const meta = jobs.readJson(req.params.id, 'job.json');
    if (!meta || !meta.output) return res.status(404).json({ error: 'לא הופק קובץ לריצה זו' });
    const p = jobs.resolveInJob(req.params.id, 'output', meta.output);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'קובץ הפלט לא נמצא' });
    res.download(p, meta.output);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** GET /api/maslul/jobs/:id/crops/:row — תמונת שורה למסך הסקירה. */
router.get('/jobs/:id/crops/:row', (req, res) => {
  try {
    const row = String(req.params.row).replace(/[^0-9]/g, '');
    const p = jobs.resolveInJob(req.params.id, 'crops', `row-${row}.png`);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.type('png').sendFile(p);
  } catch (e) {
    res.status(e.status || 400).end();
  }
});

/** GET /api/maslul/jobs/:id/pages/:n — תמונת עמוד מלא. */
router.get('/jobs/:id/pages/:n', (req, res) => {
  try {
    const n = String(req.params.n).replace(/[^0-9]/g, '');
    const p = jobs.resolveInJob(req.params.id, 'pages', `page-${n}.png`);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.type('png').sendFile(p);
  } catch (e) {
    res.status(e.status || 400).end();
  }
});

/** DELETE /api/maslul/jobs — ניקוי כל ההיסטוריה (בלתי הפיך). */
router.delete('/jobs', (req, res) => {
  try {
    const deleted = jobs.clearJobs();
    res.json({ ok: true, deleted });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** DELETE /api/maslul/jobs/:id — מחיקת ריצה אחת (בלתי הפיך). */
router.delete('/jobs/:id', (req, res) => {
  try {
    const ok = jobs.deleteJob(req.params.id);
    if (!ok) return res.status(404).json({ error: 'ריצה לא נמצאה' });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** GET /api/maslul/profiles/unilever — טבלת ה-SKU הנוכחית לפאנל הפרופיל. */
router.get('/profiles/unilever', (req, res) => {
  const p = profiles.getProfile(pipeline.DEFAULT_PAIR_ID);
  if (!p) return res.status(404).json({ error: 'פרופיל לא נמצא' });
  res.json({
    pair_id: p.pair_id,
    importer: p.importer,
    supplier: p.supplier,
    exclusions: p.exclusions,
    sku_table: p.sku_table,
  });
});

/**
 * טיפול בשגיאות multer — בלעדיו חריגה (שדה לא צפוי / חריגת גודל) מחזירה דף HTML
 * של Express במקום JSON, והלקוח נופל על פענוח התשובה.
 */
router.use((err, req, res, next) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `הקובץ גדול מהמותר (${MAX_PDF_MB}MB)`, code: 'E02' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'יש לצרף חשבון ספק (PDF) בלבד', code: 'E02' });
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: 'העלאת הקובץ נכשלה', code: 'E02' });
  }
  return next(err);
});

module.exports = router;
