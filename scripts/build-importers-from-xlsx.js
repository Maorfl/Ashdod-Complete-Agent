/**
 * build-importers-from-xlsx.js
 * קורא את דוח Focus (Sub Report 128) ומפיק:
 *   data/departments/cus1|cus2|cus3.json   — DB לקוחות לכל מחלקה (לפי נציג השירות)
 *   data/importers/<שם יבואן>/importer.json — תיקיה + קובץ נתונים לכל יבואן
 *
 * שימוש: node scripts/build-importers-from-xlsx.js [path-to-xlsx]
 * ברירת מחדל: config.report_path. משתמש ב-SheetJS בלבד (אפס תלות ב-LLM).
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const ROOT = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'config.json'), 'utf8'));
const OVERRIDE_EMAIL = config.external_email_override || 'maorfl14@gmail.com';

const argPath = process.argv[2];
const reportPath = argPath
  ? path.resolve(argPath)
  : path.resolve(ROOT, config.report_path || './data/אשדוד.xlsx');

const REP_TO_DEPT = {
  'משה רוסו': 'cus1',
  'דורון רימה': 'cus2',
  'אביהוא עבדי': 'cus3',
  'אביהו עבדי': 'cus3',
  'אביהוא עבאדי': 'cus3',
};

function safeFolder(name) {
  return String(name).trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 80)
    .replace(/[.\s]+$/, '').trim(); // Windows אינו אוהב נקודה/רווח בסוף שם תיקיה
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if ((rows[i] || []).some((c) => String(c).trim() === 'File Number')) return i;
  }
  return 5;
}

function loadSheetRows(file) {
  // תמיכה ב-CSV מקודד Windows-1255 (עברית) לצד .xlsx — כמו ב-server/src/report/reader.js
  let wb;
  if (path.extname(file).toLowerCase() === '.csv') {
    wb = XLSX.read(iconv.decode(fs.readFileSync(file), 'win1255'), { type: 'string' });
  } else {
    wb = XLSX.readFile(file);
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

function readReport(file) {
  const rows = loadSheetRows(file);
  const h = findHeaderRow(rows);
  const header = rows[h].map((c) => String(c).trim());
  const col = (n) => header.indexOf(n);
  const idx = {
    file: col('File Number'),
    cust: col('Customer Name'),
    rep: col('Cust. Service rep He'),
    clCode: col('Co Loader Code'),
    site: col('Cust. Stor. Site Des'),
    fwd: col('Inter. Forwarder'),
    station: col('Customs Station Code'),
    haz: col('Hazardous'),
  };
  // רק מספר תיק מספרי — פוסל שורת סיכום/פוטר (למשל ["Total","366 Files"])
  const data = rows.slice(h + 1).filter((r) => /^\d+$/.test(String(r[idx.file]).trim()));
  return { data, idx, headerRow: h };
}

function main() {
  if (!fs.existsSync(reportPath)) {
    console.error('לא נמצא קובץ דוח:', reportPath);
    process.exit(1);
  }
  const { data, idx, headerRow } = readReport(reportPath);

  const departments = { cus1: {}, cus2: {}, cus3: {} };
  const importers = {};

  for (const r of data) {
    const customer = String(r[idx.cust]).trim();
    if (!customer) continue;
    const rep = String(r[idx.rep]).trim();
    const dept = REP_TO_DEPT[rep] || null;
    const station = String(r[idx.station]).trim();

    if (dept) {
      departments[dept][customer] = departments[dept][customer] || {
        customer_name: customer,
        service_rep: rep,
        department: dept,
        type: 'unknown', // haifa_cont | haifa_self | tls | direct — להשלמה בעמוד היבואנים
        dangerous_rule: false,
        files: 0,
      };
      departments[dept][customer].files += 1;
    }

    if (!importers[customer]) {
      importers[customer] = {
        name: customer,
        company_id: '',
        emails: [OVERRIDE_EMAIL], // מייל היבואן מנותב ל-override
        address: '',
        notes: '',
        department: dept || '',
        service_rep: rep || '',
        type: 'unknown',
        dangerous_rule: false,
        cont_general: '',
        cont_general_emails: [],
        cont_dangerous_emails: [],
        aliases: [],
        seen_stations: new Set(),
        files: [],
      };
    }
    importers[customer].seen_stations.add(station);
    if (importers[customer].files.length < 50) importers[customer].files.push(String(r[idx.file]).trim());
  }

  const depDir = path.join(ROOT, 'data', 'departments');
  fs.mkdirSync(depDir, { recursive: true });
  for (const [dept, clients] of Object.entries(departments)) {
    fs.writeFileSync(path.join(depDir, `${dept}.json`), JSON.stringify({ department: dept, clients }, null, 2), 'utf8');
  }

  const impRoot = path.join(ROOT, 'data', 'importers');
  fs.mkdirSync(impRoot, { recursive: true });
  let created = 0;
  for (const imp of Object.values(importers)) {
    const folder = path.join(impRoot, safeFolder(imp.name));
    fs.mkdirSync(folder, { recursive: true });
    const record = { ...imp, seen_stations: [...imp.seen_stations] };
    fs.writeFileSync(path.join(folder, 'importer.json'), JSON.stringify(record, null, 2), 'utf8');
    created += 1;
  }

  console.log('דוח נקרא:', reportPath);
  console.log('שורת כותרות זוהתה בשורה (0-based):', headerRow);
  console.log('שורות נתונים:', data.length);
  console.log('תיקיות יבואנים שנוצרו:', created);
  for (const [d, c] of Object.entries(departments)) {
    console.log(`  ${d}: ${Object.keys(c).length} לקוחות`);
  }
}

main();
