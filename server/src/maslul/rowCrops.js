/**
 * maslul/rowCrops.js — חיתוך תמונת שורה מתוך עמוד ה-PNG לצורך מסך הסקירה.
 * משתמש ב-@napi-rs/canvas (כבר תלות של pdf-parse) — בלי ספרייה חדשה.
 */
const fs = require('fs');

/**
 * cropRow — חותך מלבן סביב bbox של שורת הפריט (ושורת הכמויות שמתחתיה).
 * מחזיר true אם נכתב קובץ.
 */
async function cropRow(pagePng, bbox, bboxQty, destPath, pad = 12) {
  if (!bbox) return false;
  let canvasLib;
  try { canvasLib = require('@napi-rs/canvas'); } catch { return false; }

  const img = await canvasLib.loadImage(fs.readFileSync(pagePng));
  const y0 = Math.max(0, bbox.y0 - pad);
  const y1 = Math.min(img.height, (bboxQty ? bboxQty.y1 : bbox.y1) + pad);
  const x0 = Math.max(0, bbox.x0 - pad);
  const x1 = Math.min(img.width, Math.max(bbox.x1, bboxQty ? bboxQty.x1 : 0) + pad);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);

  const canvas = canvasLib.createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  fs.writeFileSync(destPath, canvas.toBuffer('image/png'));
  return true;
}

module.exports = { cropRow };
