/**
 * db/contacts.js — מקור אמת יחיד (Task 2) ל-CO-LOADERS ולמסופים, מעל
 * config/co_loaders.json ו-config/terminals.json (בלוק terminals). כולל:
 *   - lookup לפי קוד (getCoLoaderByCode) ולפי שם מסוף (getTerminal, כולל normKey).
 *   - lookup לפי שם (findByName / emailsFor) — עבור "מבצע העברה לחיפה" שנגזר משם
 *     (Co Loader Name / Inter. Forwarder / שם מסוף), גם כשאין קוד בדוח (Task 1).
 *   - כתיבה (writeCoLoaders/writeTerminals) לעמוד הניהול (Task 3), עם רענון cache
 *     בזיכרון כך שהצנרת רואה עריכות בלי restart.
 *
 * ה-cache הוא מקור האמת לצנרת בזמן ריצה; הדיסק הוא ההתמדה. שאר הבלוקים בקבצים
 * (continuation_carriers, dangerous_goods, haifa_*) נשמרים כפי שהם בכתיבה.
 */
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('../config');

const CO_PATH = path.join(CONFIG_DIR, 'co_loaders.json');
const TERM_PATH = path.join(CONFIG_DIR, 'terminals.json');

let coDoc = JSON.parse(fs.readFileSync(CO_PATH, 'utf8'));
let termDoc = JSON.parse(fs.readFileSync(TERM_PATH, 'utf8'));

const normWs = (s) => String(s || '').replace(/\s+/g, ' ').trim();       // רווחים כפולים -> יחיד
const normName = (s) => normWs(s).toLowerCase();                          // + case-insensitive

function coLoaders() { return coDoc.co_loaders; }
function terminals() { return termDoc.terminals; }

function getCoLoaderByCode(code) { return coDoc.co_loaders[code] || null; }

// מסוף לפי שם מדויק או מנורמל-רווחים (כמו normKey הקיים במסווג)
function getTerminal(site) {
  const t = termDoc.terminals;
  if (t[site]) return t[site];
  const n = normWs(site);
  for (const [k, v] of Object.entries(t)) if (normWs(k) === n) return v;
  return null;
}

/**
 * findByName — איתור ישות (co-loader או terminal) לפי שם, בכל צורותיו:
 * שם עברי/אנגלי של קו-לואדר, שם מסוף, או alias של מסוף. מחזיר { kind, key, entry }
 * או null אם אינו מוכר במערכת.
 */
function findByName(name) {
  const n = normName(name);
  if (!n) return null;
  for (const [code, cl] of Object.entries(coDoc.co_loaders)) {
    if (normName(cl.name) === n || normName(cl.name_en) === n) return { kind: 'co_loader', key: code, entry: cl };
  }
  for (const [key, term] of Object.entries(termDoc.terminals)) {
    if (normName(key) === n) return { kind: 'terminal', key, entry: term };
    if ((term.aliases || []).some((a) => normName(a) === n)) return { kind: 'terminal', key, entry: term };
  }
  return null;
}

function isKnown(name) { return !!findByName(name); }

// כתובות המייל האמיתיות של ישות לפי שם (לרשימת הנמענים בהעברה) — [] אם אינה מוכרת
function emailsFor(name) {
  const hit = findByName(name);
  return hit ? (hit.entry.emails || []) : [];
}

function writeCoLoaders(coLoadersObj) {
  coDoc.co_loaders = coLoadersObj;
  fs.writeFileSync(CO_PATH, JSON.stringify(coDoc, null, 2) + '\n', 'utf8');
  return coDoc.co_loaders;
}

function writeTerminals(terminalsObj) {
  termDoc.terminals = terminalsObj;
  fs.writeFileSync(TERM_PATH, JSON.stringify(termDoc, null, 2) + '\n', 'utf8');
  return termDoc.terminals;
}

module.exports = {
  coLoaders, terminals, getCoLoaderByCode, getTerminal,
  findByName, isKnown, emailsFor, writeCoLoaders, writeTerminals,
};
