/**
 * maslul/templateInspector.js — אימות מבנה התבנית לפני כתיבה (מפרט §7.2).
 * כל סטייה => E03, עצירה. לא מנסים להתאים אוטומטית.
 */
const fs = require('fs');
const zipRaw = require('./zipRaw');

const SHEET = 'xl/worksheets/sheet1.xml';
const FIRST_ROW = 4;
const LAST_ROW = 203;
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

const EXPECTED_HEADERS = [
  'פרט מכס', 'קוד דגם', 'תיאור טובין',
  'כמות לפי ספר המכס', 'כמות', 'כמות עבור מכון התקנים', 'ערך פו"ב ליחידה',
];

const EXPECTED_DV = {
  'A4:A203': 'textLength', 'B4:B203': 'textLength', 'C4:C203': 'textLength',
  'D4:D203': 'decimal', 'E4:E203': 'decimal', 'F4:F203': 'decimal', 'G4:G203': 'decimal',
};

/**
 * inspect — מחזיר { ok, errors[], sheetXml, entries, styles }
 * styles: מפה ref -> ערך ה-s attribute (נשמר לכתיבה; §7.1 — אינו אחיד בין שורות)
 */
function inspect(templatePath) {
  const errors = [];
  const buf = fs.readFileSync(templatePath);

  let entries;
  try {
    entries = zipRaw.readEntries(buf);
  } catch (e) {
    return { ok: false, errors: [{ code: 'E03', message: `הקובץ אינו xlsx תקין: ${e.message}` }] };
  }

  const names = entries.map((e) => e.name);
  const sheetEntry = entries.find((e) => e.name === SHEET);
  if (!sheetEntry) {
    return { ok: false, errors: [{ code: 'E03', message: `${SHEET} חסר בתבנית` }] };
  }

  const xml = zipRaw.readData(buf, sheetEntry).toString('utf8');

  if (!/rightToLeft="1"/.test(xml)) errors.push({ code: 'E03', message: 'הגיליון אינו מוגדר rightToLeft="1"' });

  const dim = (xml.match(/<dimension ref="([^"]+)"/) || [])[1];
  if (dim !== 'A1:PW203') errors.push({ code: 'E03', message: `dimension צפוי A1:PW203, התקבל ${dim || '(חסר)'}` });

  if (!xml.includes('<drawing r:id="rId2"/>')) errors.push({ code: 'E03', message: 'חסר <drawing r:id="rId2"/>' });
  if (!xml.includes('<legacyDrawing r:id="rId3"/>')) errors.push({ code: 'E03', message: 'חסר <legacyDrawing r:id="rId3"/>' });

  // כותרות שורה 2 דרך sharedStrings
  const ssEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  if (!ssEntry) {
    errors.push({ code: 'E03', message: 'xl/sharedStrings.xml חסר' });
  } else {
    const ss = zipRaw.readData(buf, ssEntry).toString('utf8');
    const shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
    COLS.forEach((c, i) => {
      const m = xml.match(new RegExp(String.raw`<c r="${c}2"[^>]*t="s"[^>]*><v>(\d+)</v></c>`));
      const actual = m ? (shared[Number(m[1])] || '').trim() : null;
      if (actual !== EXPECTED_HEADERS[i]) {
        errors.push({ code: 'E03', message: `כותרת ${c}2 צפויה "${EXPECTED_HEADERS[i]}", התקבל ${actual === null ? '(לא נמצאה)' : `"${actual}"`}` });
      }
    });
  }

  // 7 כללי dataValidation עם ה-sqref הצפויים
  const dvs = [...xml.matchAll(/<dataValidation ([^>]*?)(?:\/>|>)/g)].map((m) => m[1]);
  if (dvs.length !== 7) errors.push({ code: 'E03', message: `צפויים 7 כללי dataValidation, נמצאו ${dvs.length}` });
  for (const [sqref, type] of Object.entries(EXPECTED_DV)) {
    const hit = dvs.find((a) => a.includes(`sqref="${sqref}"`));
    if (!hit) errors.push({ code: 'E03', message: `חסר dataValidation עבור ${sqref}` });
    else if (!hit.includes(`type="${type}"`)) errors.push({ code: 'E03', message: `dataValidation עבור ${sqref} אינו מסוג ${type}` });
  }

  // כל תאי A4:G203 קיימים וריקים; שומרים את ה-s של כל תא
  const styles = {};
  let missing = 0; let nonEmpty = 0;
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
    for (const c of COLS) {
      const ref = `${c}${r}`;
      const m = xml.match(new RegExp(String.raw`<c r="${ref}"( s="\d+")?\s*/>`));
      if (m) { styles[ref] = (m[1] || '').trim(); continue; }
      if (new RegExp(String.raw`<c r="${ref}"[^>]*>`).test(xml)) nonEmpty++; else missing++;
    }
  }
  if (missing) errors.push({ code: 'E03', message: `${missing} תאים חסרים בטווח A4:G203` });
  if (nonEmpty) errors.push({ code: 'E03', message: `${nonEmpty} תאים בטווח A4:G203 אינם ריקים` });

  return {
    ok: errors.length === 0,
    errors,
    sheetXml: xml,
    entries,
    buf,
    styles,
    names,
    cellCount: (xml.match(/<c /g) || []).length,
  };
}

module.exports = { inspect, SHEET, FIRST_ROW, LAST_ROW, COLS, EXPECTED_HEADERS };
