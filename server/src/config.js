/**
 * config.js — טוען את כל קבצי ההגדרות מ-config/ ומרכז גישה אליהם.
 * אפס תלות ב-LLM. כל ערכי ברירת המחדל והדומיין מגיעים מ-config/*.json.
 */
const fs = require('fs');
const path = require('path');

// טעינת server/.env אל process.env (סודות/override סביבתי) — לפני קריאת המשתנים.
// Node 22: process.loadEnvFile; נפילה חיננית לפרסר ידני אם אינו זמין.
(function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
      return;
    }
  } catch { /* נפילה לפרסר הידני */ }
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
})();

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_DIR = path.join(ROOT, 'config');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
}

const config = load('config.json');
const coLoadersRaw = load('co_loaders.json');
const terminalsRaw = load('terminals.json');

// override סביבתי קל (PORT/HOST/REPORT_PATH) מעל config.json
const PORT = Number(process.env.PORT || config.server?.port || 4000);
const HOST = process.env.HOST || config.server?.host || '0.0.0.0';
// report_path היחסי נפתר מול שורש הפרויקט (לא מול cwd של התהליך)
const rawReportPath = process.env.REPORT_PATH || config.report_path;
const REPORT_PATH = path.isAbsolute(rawReportPath) ? rawReportPath : path.resolve(ROOT, rawReportPath);

module.exports = {
  ROOT,
  CONFIG_DIR,
  DATA_DIR: path.join(ROOT, 'data'),
  config,
  PORT,
  HOST,
  REPORT_PATH,
  coLoaders: coLoadersRaw.co_loaders,
  terminals: terminalsRaw.terminals,
  continuationCarriers: terminalsRaw.continuation_carriers,
  dangerousGoods: terminalsRaw.dangerous_goods,
  haifaSenders: terminalsRaw.haifa_arrival_senders,
};
