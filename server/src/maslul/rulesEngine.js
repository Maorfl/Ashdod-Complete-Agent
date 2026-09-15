/**
 * maslul/rulesEngine.js — החלת החרגות ומיפוי עמודות A-G (מפרט §5-§6).
 * כל כלל מוגדר בפרופיל, לא בקוד.
 */
const sanitizer = require('./sanitizer');

/** טוקני אתר/אצווה שנצפו בסוף תיאורים (§11.1) */
const SITE_TOKENS = new Set(['BE', 'BG', 'AT', 'HULK', 'SCNT', 'ZEUS', 'DMC', 'Y2', 'DK', 'DAPH', 'DAPHNE']);
const MAX_B = 35;

/**
 * guessUnileverV1 — ניחוש קוד דגם ל-SKU שאינו בטבלה. תמיד ניחוש, לעולם לא מקודם אוטומטית.
 * 1. ניקוי  2. הסרת סיומות אתר/אצווה מהסוף  3. חיתוך טוקנים מהסוף עד <=35.
 */
function guessUnileverV1(description) {
  const removed = [];
  let tokens = sanitizer.clean(description)
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  while (tokens.length > 1 && SITE_TOKENS.has(tokens[tokens.length - 1].toUpperCase())) {
    removed.push(tokens.pop());
  }
  let lengthTrimmed = false;
  while (tokens.length > 1 && tokens.join(' ').length > MAX_B) {
    removed.push(tokens.pop());
    lengthTrimmed = true;
  }
  return { value: tokens.join(' '), removedTokens: removed.slice().reverse(), lengthTrimmed };
}

/** האם השורה מוחרגת? מחזיר את כלל ההחרגה או null. */
function findExclusion(line, profile) {
  for (const ex of profile.exclusions || []) {
    if (ex.type !== 'regex_on_description') continue;
    let re;
    try { re = new RegExp(ex.pattern, 'i'); } catch { continue; }
    if (re.test(line.description || '')) return ex;
  }
  return null;
}

/**
 * buildRows — ממפה InvoiceLine[] ל-OutputRow[] עם סטטוס לכל עמודה.
 * מחזיר { rows, excluded, errors }
 */
function buildRows(lines, profile, rowChecks = []) {
  const cols = profile.columns || {};
  const rows = [];
  const excluded = [];
  const errors = [];

  for (const line of lines) {
    const ex = findExclusion(line, profile);
    if (ex) {
      excluded.push({ line, rule: ex.id, pattern: ex.pattern, description: line.description, sku: line.sku, item_no: line.item_no });
      continue;
    }

    const status = {};
    const notes = [];
    const row = {
      source_line: line.line_no, sku: line.sku, item_no: line.item_no,
      raw: line.raw, page: line.page, bbox: line.bbox, description: line.description,
    };

    // A - hs_map
    const aCfg = cols.A || {};
    const mapped = (aCfg.map || {})[line.hs_code];
    if (mapped) {
      const v = sanitizer.validateA(mapped);
      if (v.ok) { row.A = v.value; status.A = 'verified'; }
      else { row.A = null; status.A = 'blocked'; notes.push(v.message); errors.push({ code: v.code, sku: line.sku, message: v.message }); }
    } else {
      row.A = null; status.A = 'blocked';
      const msg = `אין מיפוי לקוד HS "${line.hs_code}" - נדרש סיווג מכס ידני`;
      notes.push(msg); errors.push({ code: 'E04', sku: line.sku, message: msg });
    }

    // B - sku_table + guess. ערך הטבלה גובר תמיד על התיאור מה-OCR (§8).
    const entry = (profile.sku_table || {})[line.sku];
    if (entry && entry.model && entry.status !== 'excluded') {
      const v = sanitizer.validateB(entry.model);
      if (v.ok) {
        row.B = v.value;
        status.B = entry.status === 'verified' ? 'verified' : 'guess';
        if (entry.status !== 'verified') {
          row.guess = { from: 'sku_table', description: line.description, proposed: v.value, removedTokens: [], lengthTrimmed: false };
        }
      } else {
        row.B = null; status.B = 'blocked'; notes.push(v.message); errors.push({ code: v.code, sku: line.sku, message: v.message });
      }
    } else if ((cols.B || {}).on_unknown === 'guess_unilever_v1') {
      const g = guessUnileverV1(line.description);
      const v = sanitizer.validateB(g.value);
      if (v.ok) {
        row.B = v.value; status.B = 'guess';
        row.guess = { from: 'guess_unilever_v1', description: line.description, proposed: v.value, removedTokens: g.removedTokens, lengthTrimmed: g.lengthTrimmed };
        notes.push(`קוד דגם בניחוש (הוסרו: ${g.removedTokens.join(', ') || 'כלום'})`);
      } else {
        row.B = null; status.B = 'blocked'; notes.push(v.message); errors.push({ code: v.code, sku: line.sku, message: v.message });
      }
    } else {
      row.B = null; status.B = 'blocked';
      const msg = `SKU "${line.sku}" אינו בטבלה ואין כלל ניחוש`;
      notes.push(msg); errors.push({ code: 'E05', sku: line.sku, message: msg });
    }

    // C - constant
    const cCfg = cols.C || {};
    if (cCfg.type === 'constant') {
      const v = sanitizer.validateC(cCfg.value);
      if (v.ok) { row.C = v.value; status.C = cCfg.status === 'verified' ? 'verified' : 'guess'; }
      else { row.C = null; status.C = 'blocked'; notes.push(v.message); errors.push({ code: v.code, sku: line.sku, message: v.message }); }
    }

    // D / E / F - כמות
    const dCfg = cols.D || {};
    const qty = line[dCfg.field || 'qty_in_zun'];
    const dv = sanitizer.validateNum(qty, 'D');
    if (dv.ok) {
      row.D = Number(dv.value);
      status.D = dCfg.status === 'verified' ? 'verified' : 'guess';
      for (const c of ['E', 'F']) {
        if ((cols[c] || {}).type === 'same_as') {
          row[c] = row.D;
          status[c] = cols[c].status === 'verified' ? 'verified' : 'guess';
        }
      }
    } else {
      row.D = null; row.E = null; row.F = null;
      status.D = 'blocked'; status.E = 'blocked'; status.F = 'blocked';
      notes.push(dv.message); errors.push({ code: dv.code, sku: line.sku, message: dv.message });
    }

    // G - skip
    if ((cols.G || {}).type === 'skip') { row.G = null; status.G = 'skip'; }

    // כשל checksum ברמת שורה => חסימת השורה
    const chk = rowChecks.find((c) => c.item_no === line.item_no && c.sku === line.sku);
    if (chk && !chk.ok) {
      for (const issue of chk.issues) {
        notes.push(issue.message);
        errors.push({ code: issue.code, sku: line.sku, message: issue.message });
        if (issue.code === 'E07') { status.D = 'blocked'; status.E = 'blocked'; status.F = 'blocked'; }
        if (issue.code === 'E04') { status.A = 'blocked'; }
      }
    }

    row.status = status;
    row.notes = notes;
    row.blocked = Object.values(status).some((s) => s === 'blocked');
    rows.push(row);
  }

  return { rows, excluded, errors };
}

module.exports = { buildRows, guessUnileverV1, findExclusion, SITE_TOKENS, MAX_B };
