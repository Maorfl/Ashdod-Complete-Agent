/**
 * generate-instructions.js — כתיבת/רענון instructions.txt לכל לקוחות ההעברה לחיפה
 * (customer_whitelist). אידמפוטנטי — התוכן נגזר כולו מ-importer.json החי.
 * לשוטף אין צורך בסקריפט: create/update ב-db/importers.js מרעננים אוטומטית.
 * שימוש: node scripts/generate-instructions.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const imp = require(path.join(ROOT, 'server', 'src', 'db', 'importers'));
const config = require(path.join(ROOT, 'config', 'config.json'));

const wl = (config.report_scope && config.report_scope.customer_whitelist) || [];
let written = 0;
const missing = [];
for (const name of wl) {
  const rec = imp.findByName(name);
  if (!rec) { missing.push(name); continue; }
  const dest = imp.writeInstructions(rec._folder, rec);
  if (dest) { written += 1; console.log('✓', dest); }
}
console.log(`\nנכתבו: ${written}/${wl.length}`, missing.length ? `| ללא תיקיה: ${JSON.stringify(missing)}` : '');
