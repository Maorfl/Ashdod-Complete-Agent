/**
 * services/ocr.js — OCR מקומי לקריאת PDF/סריקות במקרי קצה.
 * משתמש ב-tesseract.js (heb+eng) — ספרייה מקומית, אפס תלות ב-LLM/שירות חיצוני.
 * נטען עצלן (lazy) כדי לא להאט את עליית השרת.
 */
const { config } = require('../config');

let worker = null;

async function getWorker() {
  if (worker) return worker;
  const { createWorker } = require('tesseract.js');
  worker = await createWorker(config.ocr?.lang || 'heb+eng');
  return worker;
}

async function ocrImage(input) {
  if (!config.ocr?.enabled) throw new Error('OCR מנוטרל ב-config');
  const w = await getWorker();
  const { data } = await w.recognize(input);
  return data.text;
}

async function shutdown() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

module.exports = { ocrImage, shutdown };
