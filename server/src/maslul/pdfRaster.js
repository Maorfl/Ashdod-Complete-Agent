/**
 * maslul/pdfRaster.js — רסטור עמודי PDF ל-PNG.
 *
 * בחירת רסטרייזר: pdf-parse (getScreenshot) — pdfjs-dist + @napi-rs/canvas.
 * *כבר תלות קיימת בפרויקט* (services/ocr.js משתמש בה), מגיע עם בינאריים מוכנים
 * ואינו דורש טולצ'יין קומפילציה ב-Windows. אפס תלויות חדשות.
 *
 * חשבונות הספק הם סריקות טהורות (0 תווי טקסט חילוץ) — הרסטור אינו מקרה קצה
 * אלא הנתיב היחיד.
 */
const fs = require('fs');
const path = require('path');

// A4 ב-72dpi = 595pt; scale 4.1667 => ~300 DPI על הצד הארוך
const SCALE_300DPI = 4.1667;

/** האם העמוד ריק? PNG קטן מאוד = כמעט ללא תוכן (עמוד לבן). */
function isLikelyBlank(pngBuffer, thresholdBytes = 120 * 1024) {
  return pngBuffer.length < thresholdBytes;
}

/**
 * rasterize — מרנדר את כל עמודי ה-PDF ל-PNG בתיקיית היעד.
 * מחזיר [{ page, file, width, height, blank }]
 */
async function rasterize(pdfPath, outDir, { scale = SCALE_300DPI, onProgress } = {}) {
  const { PDFParse } = require('pdf-parse');
  fs.mkdirSync(outDir, { recursive: true });
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
  try {
    const info = await parser.getInfo();
    const total = info.total || info.numpages || 1;

    // חשוב: יש לבקש את *כל* העמודים בקריאה אחת. קריאות getScreenshot חוזרות על
    // אותו instance מתעלמות מבורר העמודים ומחזירות שוב ושוב את עמוד 1 — מה שגרם
    // בעבר לשורות כפולות ולעמוד הסיכום שלא נקרא.
    const pageNums = Array.from({ length: total }, (_, i) => i + 1);
    if (onProgress) onProgress({ page: 1, total });
    const shot = await parser.getScreenshot({ pages: pageNums, scale });

    const pages = [];
    for (const entry of shot.pages || []) {
      const n = entry.pageNumber;
      if (onProgress) onProgress({ page: n, total });
      const buf = Buffer.from(entry.data);
      const file = path.join(outDir, `page-${n}.png`);
      fs.writeFileSync(file, buf);
      pages.push({
        page: n,
        file,
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        bytes: buf.length,
        blank: isLikelyBlank(buf),
      });
    }
    pages.sort((a, b) => a.page - b.page);
    return { total, pages };
  } finally {
    await parser.destroy();
  }
}

module.exports = { rasterize, isLikelyBlank, SCALE_300DPI };
