/**
 * services/ocr.js — OCR מקומי לקריאת PDF/סריקות במקרי קצה.
 * משתמש ב-tesseract.js (heb+eng) — ספרייה מקומית, אפס תלות ב-LLM/שירות חיצוני.
 * נטען עצלן (lazy) כדי לא להאט את עליית השרת.
 *
 * שתי נקודות עדינות (שתיהן גרמו בעבר לקריסת השרת / לנתיב מת):
 *
 * 1. tesseract/Leptonica *אינו* יודע לקרוא PDF ("pixReadStream: Pdf reading is not
 *    supported") — הוא מקבל רסטר בלבד. לכן PDF עובר כאן רנדור לעמוד PNG דרך
 *    pdf-parse (getScreenshot; אותה ספרייה שכבר משמשת לחילוץ הטקסט — pdfjs-dist +
 *    @napi-rs/canvas, בלי תלות חדשה ובלי קומפילציה מקומית) לפני ה-recognize.
 * 2. createWorker חייב errorHandler מפורש. בלעדיו tesseract.js עושה `throw` חשוף
 *    בתוך callback של הודעה מה-worker (createWorker.js) — כלומר מחוץ לשרשרת ה-await
 *    שלנו — וה-throw בורח ל-process.nextTick כחריגה לא-מטופלת שמפילה את התהליך כולו.
 *    שום try/catch סביב ocrImage() לא יכול לתפוס אותו. עם errorHandler החריגה נשארת
 *    בתוך ה-Promise שנדחה ונתפסת רגיל אצל הקורא.
 */
const fs = require('fs');
const { config } = require('../config');

let worker = null;

async function getWorker() {
  if (worker) return worker;
  const { createWorker } = require('tesseract.js');
  // errorHandler — ראו הערה (2) בכותרת: מונע throw חשוף שמפיל את התהליך.
  worker = await createWorker(config.ocr?.lang || 'heb+eng', undefined, {
    errorHandler: (e) => { console.error('[ocr] שגיאת tesseract:', e?.message || e); },
  });
  return worker;
}

/** רנדור עמודי ה-PDF הראשונים ל-PNG. ראו הערה (1) בכותרת. */
async function renderPdfPages(pdfPath, maxPages, scale) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
  try {
    const pageNums = Array.from({ length: maxPages }, (_, i) => i + 1);
    // scale 2 (~1190x1684 ל-A4) — ב-scale 1 הטקסט קטן מדי ו-tesseract מחזיר רעש.
    const shot = await parser.getScreenshot({ pages: pageNums, scale });
    return (shot.pages || []).map((p) => Buffer.from(p.data));
  } finally {
    await parser.destroy();
  }
}

/**
 * ocrImage — מקבל נתיב PDF / נתיב תמונה / Buffer ומחזיר טקסט.
 * PDF מרונדר לעמודים ומועבר עמוד-עמוד; שאר הקלטים עוברים כמו שהם ל-tesseract.
 */
async function ocrImage(input) {
  if (!config.ocr?.enabled) throw new Error('OCR מנוטרל ב-config');
  const w = await getWorker();

  const isPdfPath = typeof input === 'string' && /\.pdf$/i.test(input);
  if (!isPdfPath) {
    const { data } = await w.recognize(input);
    return data.text;
  }

  const maxPages = config.ocr?.max_pages || 3;
  const scale = config.ocr?.scale || 2;
  const pages = await renderPdfPages(input, maxPages, scale);
  if (!pages.length) throw new Error('רנדור ה-PDF לא החזיר עמודים');

  const out = [];
  for (const png of pages) {
    const { data } = await w.recognize(png);
    if (data.text) out.push(data.text);
  }
  return out.join('\n');
}

async function shutdown() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

module.exports = { ocrImage, shutdown };
