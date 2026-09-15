/**
 * maslul/templateWriter.js — כתיבה כירורגית ל-sheet1.xml (מפרט §7.3).
 *
 * איסור מוחלט: לא לפתוח/לשמור עם ספריית גיליונות (SheetJS write, openpyxl וכו') —
 * זה כותב מחדש את ה-package ושובר את comments/drawings, ומסלול נכשל בייבוא עם
 * "Cannot read properties of undefined (reading 'comments')".
 * עובדים בהחלפת מחרוזות על ה-XML הגולמי ואורזים מחדש עם אותו סדר ושיטת דחיסה.
 */
const zipRaw = require('./zipRaw');
const { fmtNum, xmlEscape } = require('./sanitizer');
const { SHEET, FIRST_ROW, LAST_ROW } = require('./templateInspector');

const TEXT_COLS = new Set(['A', 'B', 'C']);
const NUM_COLS = new Set(['D', 'E', 'F', 'G']);

/**
 * writeRows — מקבל תוצאת inspect() ורשימת שורות ({A,B,C,D,E,F,G}), ומחזיר Buffer של xlsx.
 * תא ריק/null/'' — לא נכתב כלל (נשאר כמו בתבנית, §7.3).
 */
function writeRows(inspection, rows, { firstRow = FIRST_ROW, lastRow = LAST_ROW } = {}) {
  if (rows.length > lastRow - firstRow + 1) {
    const err = new Error(`יותר מ-${lastRow - firstRow + 1} שורות (${rows.length})`);
    err.code = 'E08';
    throw err;
  }

  let xml = inspection.sheetXml;
  const written = [];

  for (let i = 0; i < rows.length; i++) {
    const r = firstRow + i;
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      const val = rows[i][col];
      if (val === null || val === undefined || val === '') continue;
      const ref = `${col}${r}`;
      const re = new RegExp(String.raw`<c r="${ref}"( s="\d+")?\s*/>`);
      const m = xml.match(re);
      if (!m) {
        const err = new Error(`תא ${ref} לא נמצא ריק בתבנית`);
        err.code = 'E03';
        throw err;
      }
      const sAttr = m[1] || '';
      let cell;
      if (TEXT_COLS.has(col)) {
        // קוד דגם מספרי (למשל "1002843.1") נכתב כטקסט — לעולם לא כמספר (§7.3)
        cell = `<c r="${ref}"${sAttr} t="inlineStr"><is><t>${xmlEscape(val)}</t></is></c>`;
      } else if (NUM_COLS.has(col)) {
        cell = `<c r="${ref}"${sAttr}><v>${fmtNum(val)}</v></c>`;
      } else {
        throw new Error(`עמודה לא נתמכת: ${col}`);
      }
      xml = xml.slice(0, m.index) + cell + xml.slice(m.index + m[0].length);
      written.push({ ref, col, value: val, style: sAttr.trim() });
    }
  }

  const buf = zipRaw.writeZip(inspection.buf, inspection.entries, {
    [SHEET]: Buffer.from(xml, 'utf8'),
  });
  return { buf, xml, written };
}

module.exports = { writeRows, TEXT_COLS, NUM_COLS };
