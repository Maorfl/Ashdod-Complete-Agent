/**
 * report/reader.js — קריאת דוח Focus (Sub Report 128) עם SheetJS בלבד.
 * מזהה את שורת הכותרת דינמית (חוסן מול שינוי מיקום), ומחזיר רשומות מנורמלות.
 * אפס תלות ב-LLM.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const COLS = {
  file: 'File Number',
  fcl: 'FCL/LCL',
  cust: 'Customer Name',
  rep: 'Cust. Service rep He',
  deal: 'Deal ID',
  clCode: 'Co Loader Code',
  clName: 'Co Loader Name',
  reshimon: 'WG Reshimon No',
  site: 'Cust. Stor. Site Des',
  fwd: 'Inter. Forwarder',
  transport: 'Transport Type',
  station: 'Customs Station Code',
  stationName: 'Customs Station Name',
  haz: 'Hazardous',
  relDate: 'wg dec release date',
};

/**
 * המרת תאריך סריאלי של Excel ל-ISO (yyyy-mm-dd). דטרמיניסטי, עמיד לערכים
 * ריקים/לא-מספריים (מחזיר null). 25569 = ימי האפוק של Excel עד 1970-01-01.
 */
function excelSerialToISO(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n) || n <= 0) return null;
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if ((rows[i] || []).some((c) => String(c).trim() === COLS.file)) return i;
  }
  return 5; // ברירת מחדל (בקובץ הדוגמה הכותרות בשורה 6 = אינדקס 5)
}

function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * טוען את שורות הדוח. תומך ב-.xlsx (SheetJS ישירות) וב-.csv המקודד Windows-1255
 * (עברית) — מפענחים את הבייטים ב-iconv-lite ואז מפרסרים כמחרוזת, אחרת ה-CSV
 * מתקבל כ-mojibake. אפס תלות ב-LLM.
 */
function loadSheetRows(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let wb;
  if (ext === '.csv') {
    const decoded = iconv.decode(fs.readFileSync(filePath), 'win1255');
    wb = XLSX.read(decoded, { type: 'string' });
  } else {
    wb = XLSX.readFile(filePath);
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

function readReport(filePath) {
  const rows = loadSheetRows(filePath);
  const h = findHeaderRow(rows);
  const header = rows[h].map((c) => String(c).trim());
  const at = {};
  for (const [key, label] of Object.entries(COLS)) at[key] = header.indexOf(label);

  const records = [];
  for (const r of rows.slice(h + 1)) {
    const fileNumber = str(r[at.file]);
    // רק מספר תיק מספרי — פוסל שורות סיכום/פוטר כמו ["Total","366 Files"]
    if (!/^\d+$/.test(fileNumber)) continue;
    records.push({
      file_number: fileNumber,
      fcl_lcl: str(r[at.fcl]),
      customer_name: str(r[at.cust]),
      service_rep: str(r[at.rep]),
      deal_id: str(r[at.deal]),
      co_loader_code: str(r[at.clCode]),
      co_loader_name: str(r[at.clName]),
      wg_reshimon_no: str(r[at.reshimon]),
      site_des: str(r[at.site]),
      forwarder: str(r[at.fwd]),
      transport_type: str(r[at.transport]),
      customs_station_code: str(r[at.station]),
      customs_station_name: str(r[at.stationName]),
      hazardous: str(r[at.haz]),
      release_date: at.relDate >= 0 ? excelSerialToISO(r[at.relDate]) : null,
    });
  }
  return { records, headerRow: h };
}

module.exports = { readReport, COLS, findHeaderRow, excelSerialToISO };
