/**
 * db/importers.js — שכבת נתוני יבואנים. כל יבואן = תיקיה תחת data/importers/<שם>
 * ובתוכה importer.json (שם, ח.פ, מיילים, כתובת, הערות, type, מחלקה). קבצי JSON לוקאליים, לא DB.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');

const IMP_ROOT = path.join(DATA_DIR, 'importers');

function safeFolder(name) {
  return String(name).trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 80)
    .replace(/[.\s]+$/, '').trim(); // Windows אינו אוהב נקודה/רווח בסוף שם תיקיה
}

function ensureRoot() {
  fs.mkdirSync(IMP_ROOT, { recursive: true });
}

function list() {
  ensureRoot();
  return fs
    .readdirSync(IMP_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readByFolder(d.name))
    .filter(Boolean);
}

function readByFolder(folder) {
  const p = path.join(IMP_ROOT, folder, 'importer.json');
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { _folder: folder, ...data };
}

// איתור יבואן לפי שם מדויק או alias (לשימוש המסווג)
function findByName(name) {
  if (!name) return null;
  const target = String(name).trim().toLowerCase();
  for (const imp of list()) {
    if (imp.name && imp.name.trim().toLowerCase() === target) return imp;
    if (Array.isArray(imp.aliases) && imp.aliases.some((a) => String(a).trim().toLowerCase() === target)) return imp;
  }
  return null;
}

function create(data) {
  ensureRoot();
  if (!data.name) throw new Error('שם יבואן חובה');
  const folder = safeFolder(data.name);
  const dir = path.join(IMP_ROOT, folder);
  if (fs.existsSync(path.join(dir, 'importer.json'))) throw new Error('יבואן כבר קיים');
  fs.mkdirSync(dir, { recursive: true });
  const record = normalize(data);
  fs.writeFileSync(path.join(dir, 'importer.json'), JSON.stringify(record, null, 2), 'utf8');
  return { _folder: folder, ...record };
}

function update(folder, patch) {
  const current = readByFolder(folder);
  if (!current) throw new Error('יבואן לא נמצא');
  delete current._folder;
  const merged = normalize({ ...current, ...patch });
  fs.writeFileSync(path.join(IMP_ROOT, folder, 'importer.json'), JSON.stringify(merged, null, 2), 'utf8');
  return { _folder: folder, ...merged };
}

function remove(folder) {
  const dir = path.join(IMP_ROOT, folder);
  if (!fs.existsSync(dir)) throw new Error('יבואן לא נמצא');
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}

// type ∈ haifa_cont | haifa_self | tls | direct | unknown — קובע את מסלול ההמשך
function normalize(d) {
  return {
    name: d.name || '',
    company_id: d.company_id || '',
    emails: Array.isArray(d.emails) ? d.emails : d.emails ? [d.emails] : [],
    address: d.address || '',
    notes: d.notes || '',
    department: d.department || '',
    service_rep: d.service_rep || '',
    type: d.type || 'unknown',
    dangerous_rule: !!d.dangerous_rule,
    cont_general: d.cont_general || '',
    cont_general_emails: d.cont_general_emails || [],
    cont_dangerous_emails: d.cont_dangerous_emails || [],
    aliases: d.aliases || [],
    seen_stations: d.seen_stations || [],
    files: d.files || [],
  };
}

module.exports = { list, readByFolder, findByName, create, update, remove, safeFolder, IMP_ROOT };
