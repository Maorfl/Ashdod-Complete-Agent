/**
 * maslul/invoiceParsers/unileverEuropeV1.js — פרסר חשבונות Unilever Europe BV.
 *
 * מבנה פריט = שתי שורות פיזיות:
 *   000010  65223592  RFM AP 150ML ICED LEMON SAGE HULK BG  33072000  United Kingdom  8720181820335  345,408 KG  263,424 KG
 *           448 CS    2.688 ZUN   1.715,27   0,00   638,120 EUR per 1000 ZUN   1.715,27   0,00 %   0,00
 *
 * התיאור = הטוקנים שבין ה-Material בן 8 הספרות לבין קוד ה-Commodity.
 * מספרי הפריט אינם רציפים (בחשבון 7113482802 חסר 000020) — הם תווית, לא אינדקס.
 */
const { parseNumber, detectNumberFormat } = require('../sanitizer');

const ITEM_RE = /^\s*(\d{6})\s+(\d{8})\s+(.+?)\s+(\d{8})\s+/;
const QTY_RE = /(\d[\d.,]*)\s*CS\b/;
const ZUN_RE = /(\d[\d.,]*)\s*ZUN\b/;
const PRICE_RE = /(\d[\d.,]*)\s*EUR\s+per\s+1000\s+ZUN/i;
const EAN_RE = /\b(\d{13})\b/;

// ה-OCR קורא לעיתים את ה-':' כתו אחר (y / - / ;) — מתירים רעש קצר שאינו ספרה
const TOTAL_VALUE_RE = /Total\s+Material\s+Value\s+in\s+EUR[^\d\r\n]{0,6}([\d][\d.,]*)/i;
const TOTAL_CASES_RE = /Total\s+Number\s+of\s+Cases[^\d\r\n]{0,6}([\d][\d.,]*)/i;
const INVOICE_NO_RE = /\b(7\d{9})\b/;

/**
 * parse — מקבל [{ page, lines }] ומחזיר { lines: InvoiceLine[], totals, header, unmatched }
 */
function parse(pages) {
  const out = [];
  // הפורמט נקבע פעם אחת מכל טקסט החשבון — ראו detectNumberFormat. קביעה פר-מספר
  // אינה אפשרית: '646.060' חוקי בשני הפורמטים ומשמעותו שונה פי 1000.
  const allText = pages.map((p) => (p.lines || []).map((l) => l.text || '').join('\n')).join('\n');
  const numFormat = detectNumberFormat(allText);
  const num = (v) => parseNumber(v, numFormat);
  const unmatched = [];
  let totals = { cases: null, value: null, casesRaw: null, valueRaw: null };
  const header = { supplier: null, invoiceNo: null, invoiceDate: null };

  for (const pg of pages) {
    const lines = pg.lines || [];
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].text || '';

      if (!header.supplier && /unilever\s+europe\s+b\.?\s?v/i.test(text)) header.supplier = 'Unilever Europe BV';
      if (!header.invoiceNo) {
        const m = text.match(INVOICE_NO_RE);
        if (m && /invoice|document|no\b/i.test(text)) header.invoiceNo = m[1];
      }

      const tv = text.match(TOTAL_VALUE_RE);
      if (tv) { totals.valueRaw = tv[1]; totals.value = num(tv[1]); }
      const tc = text.match(TOTAL_CASES_RE);
      if (tc) { totals.casesRaw = tc[1]; totals.cases = num(tc[1]); }

      const m = text.match(ITEM_RE);
      if (!m) continue;

      const [, itemNo, sku, middle, hsCode] = m;
      // שורת הכמויות היא השורה/ות הבאות — מחפשים את הראשונה שיש בה CS וגם ZUN
      let qtyLine = null; let qtyIdx = -1;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const t = lines[j].text || '';
        if (QTY_RE.test(t) && ZUN_RE.test(t)) { qtyLine = t; qtyIdx = j; break; }
      }
      if (!qtyLine) {
        unmatched.push({ page: pg.page, line: text, reason: 'no_qty_line' });
        continue;
      }

      const qtyCs = num((qtyLine.match(QTY_RE) || [])[1]);
      const qtyZun = num((qtyLine.match(ZUN_RE) || [])[1]);
      const unitPrice = num((qtyLine.match(PRICE_RE) || [])[1]);
      // ערך השורה = המספר שאחרי ה-ZUN ולפני ה-0,00 (המופע הראשון של סכום בשורה)
      const afterZun = qtyLine.slice(qtyLine.indexOf('ZUN') + 3);
      const valueMatch = numFormat === 'anglo'
        ? afterZun.match(/([\d]{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/)
        : afterZun.match(/([\d]{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/);
      const valueEur = num(valueMatch ? valueMatch[1] : null);
      const ean = (text.match(EAN_RE) || [])[1] || null;

      // התיאור: middle מנוקה מ-EAN/מדינה/משקלים שנדבקו
      let description = middle.replace(/\s+/g, ' ').trim();

      out.push({
        line_no: out.length + 1,
        item_no: itemNo,
        sku,
        description,
        hs_code: hsCode,
        qty_cs: qtyCs,
        qty_in_zun: qtyZun,
        unit_price_per_1000: unitPrice,
        value_eur: valueEur,
        ean,
        page: pg.page,
        bbox: lines[i].bbox,
        bboxQty: qtyIdx >= 0 ? lines[qtyIdx].bbox : null,
        raw: { itemLine: text, qtyLine },
      });
    }
  }

  return { lines: out, totals, header, unmatched, numFormat };
}

module.exports = { parse, id: 'unilever_europe_v1' };
