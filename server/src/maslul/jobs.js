/**
 * maslul/jobs.js — היסטוריית ריצות תחת data/maslul/jobs/<job_id>/.
 * כל ריצה נשמרת: הקלט, הרסטר, ה-OCR, הפרסור, הסקירה, ההחלטות והפלט.
 * אין כתיבת xlsx לפני אישור אנושי — output/ נוצר רק ב-generate.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');

const JOBS_ROOT = path.join(DATA_DIR, 'maslul', 'jobs');

function newJobId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 7)}`;
}

/** מוודא ש-jobId בטוח לשימוש כרכיב נתיב (הגנה מפני path traversal מה-API). */
function safeJobId(jobId) {
  const id = String(jobId || '');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw Object.assign(new Error('מזהה ריצה לא חוקי'), { status: 400 });
  return id;
}

function jobDir(jobId) {
  return path.join(JOBS_ROOT, safeJobId(jobId));
}

function createJob() {
  const id = newJobId();
  const dir = jobDir(id);
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'crops'), { recursive: true });
  return { id, dir };
}

/**
 * writeJson — כתיבה לתיקיית הריצה.
 * אם התיקייה כבר אינה קיימת (המשתמש מחק את הריצה בזמן שהניתוח רץ ברקע)
 * הכתיבה מדולגת בשקט: הריצה נזנחה, ואין להפיל משימת רקע בגלל מחיקה לגיטימית.
 */
function writeJson(jobId, name, data) {
  const dir = jobDir(jobId);
  if (!fs.existsSync(dir)) return false;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2), 'utf8');
  return true;
}

function readJson(jobId, name) {
  const p = path.join(jobDir(jobId), name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveMeta(jobId, patch) {
  const cur = readJson(jobId, 'job.json') || {};
  const next = { ...cur, ...patch, job_id: jobId, updated_at: new Date().toISOString() };
  writeJson(jobId, 'job.json', next); // no-op אם הריצה נמחקה בינתיים
  return next;
}

function listJobs() {
  if (!fs.existsSync(JOBS_ROOT)) return [];
  return fs.readdirSync(JOBS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readJson(d.name, 'job.json'))
    .filter(Boolean)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/** נתיב קובץ בתוך תיקיית ה-job, עם אכיפה שלא יוצאים מחוץ לה. */
function resolveInJob(jobId, ...parts) {
  const dir = jobDir(jobId);
  const p = path.resolve(dir, ...parts);
  if (!p.startsWith(path.resolve(dir))) throw Object.assign(new Error('נתיב לא חוקי'), { status: 400 });
  return p;
}

/**
 * deleteJob — מחיקת ריצה אחת על כל תוכנה.
 * המחיקה מוגבלת במפורש לתוך JOBS_ROOT: safeJobId חוסם רכיבי נתיב זדוניים,
 * והבדיקה מול resolve(JOBS_ROOT) חוסמת כל ניסיון לצאת מהתיקייה.
 */
function deleteJob(jobId) {
  const dir = jobDir(jobId);
  const root = path.resolve(JOBS_ROOT);
  const target = path.resolve(dir);
  if (target === root || !target.startsWith(root + path.sep)) {
    throw Object.assign(new Error('נתיב לא חוקי'), { status: 400 });
  }
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

/** clearJobs — מחיקת כל ההיסטוריה. מוחק רק תיקיות ריצה בתוך JOBS_ROOT. */
function clearJobs() {
  if (!fs.existsSync(JOBS_ROOT)) return 0;
  let n = 0;
  for (const d of fs.readdirSync(JOBS_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    if (!/^[A-Za-z0-9_-]+$/.test(d.name)) continue;
    fs.rmSync(path.join(JOBS_ROOT, d.name), { recursive: true, force: true });
    n++;
  }
  return n;
}

module.exports = {
  JOBS_ROOT, createJob, jobDir, safeJobId, writeJson, readJson,
  saveMeta, listJobs, resolveInJob, newJobId, deleteJob, clearJobs,
};
