/**
 * maslul/invoiceOcr.js — OCR לעמודי חשבון ספק.
 *
 * שפה: 'eng' בלבד (ולא heb+eng כברירת המחדל של services/ocr.js) — החשבונות
 * כולם באנגלית, ונתוני אימון עבריים רק מוסיפים בלבול בזיהוי ספרות.
 * worker נטען עצלן ונשמר בין קריאות; לכל job נעשה terminate בסוף.
 */
let worker = null;

async function getWorker() {
  if (worker) return worker;
  const { createWorker } = require('tesseract.js');
  // errorHandler מפורש — בלעדיו tesseract.js זורק מחוץ לשרשרת ה-await ומפיל את התהליך
  worker = await createWorker('eng', undefined, {
    errorHandler: (e) => console.error('[maslul/ocr] tesseract:', e?.message || e),
  });
  return worker;
}

/**
 * ocrPage — מחזיר { text, lines: [{ text, bbox, words }] }
 * שומר bounding boxes ברמת מילה — נדרש גם לשחזור בלוקי-פריט לפי y וגם לחיתוך תמונת שורה.
 */
async function ocrPage(pngPath) {
  const fs = require('fs');
  const w = await getWorker();
  const { data } = await w.recognize(fs.readFileSync(pngPath), {}, { blocks: true, text: true });

  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        lines.push({
          text: line.text.replace(/\s+$/, ''),
          bbox: line.bbox,
          words: (line.words || []).map((wd) => ({ text: wd.text, bbox: wd.bbox, confidence: wd.confidence })),
        });
      }
    }
  }
  // נפילה לאחור: אם המבנה ההיררכי לא הוחזר, לפחות נחזיר שורות טקסט
  if (!lines.length && data.text) {
    for (const t of data.text.split('\n')) if (t.trim()) lines.push({ text: t, bbox: null, words: [] });
  }
  return { text: data.text || '', lines };
}

async function shutdown() {
  if (worker) { await worker.terminate(); worker = null; }
}

module.exports = { ocrPage, shutdown };
