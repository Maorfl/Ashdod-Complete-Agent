/**
 * maslul/packageVerifier.js — אימות ה-package אחרי כתיבה (מפרט §7.4).
 * כשל באחד מהאימותים => E09, הקובץ לא נמסר (הקורא מוחק אותו).
 */
const zipRaw = require('./zipRaw');
const { SHEET } = require('./templateInspector');

function verify(templateBuf, outBuf, plannedRows, firstRow = 4) {
  const errors = [];
  const a = zipRaw.readEntries(templateBuf);
  const b = zipRaw.readEntries(outBuf);

  const an = a.map((e) => e.name);
  const bn = b.map((e) => e.name);
  if (JSON.stringify(an) !== JSON.stringify(bn)) {
    errors.push({ code: 'E09', message: 'רשימת/סדר הקבצים ב-package השתנה' });
    return { ok: false, errors };
  }

  for (const e of a) {
    if (e.name === SHEET) continue;
    const other = b.find((x) => x.name === e.name);
    if (!zipRaw.readData(templateBuf, e).equals(zipRaw.readData(outBuf, other))) {
      errors.push({ code: 'E09', message: `קובץ השתנה ב-package: ${e.name}` });
    }
    if (e.method !== other.method) {
      errors.push({ code: 'E09', message: `שיטת הדחיסה השתנתה: ${e.name}` });
    }
  }

  const srcXml = zipRaw.readData(templateBuf, a.find((e) => e.name === SHEET)).toString('utf8');
  const outXml = zipRaw.readData(outBuf, b.find((e) => e.name === SHEET)).toString('utf8');

  if (!outXml.includes('<drawing r:id="rId2"/>')) errors.push({ code: 'E09', message: 'חסר <drawing r:id="rId2"/> בפלט' });
  if (!outXml.includes('<legacyDrawing r:id="rId3"/>')) errors.push({ code: 'E09', message: 'חסר <legacyDrawing r:id="rId3"/> בפלט' });

  const srcCount = (srcXml.match(/<c /g) || []).length;
  const outCount = (outXml.match(/<c /g) || []).length;
  if (srcCount !== outCount) errors.push({ code: 'E09', message: `מספר התאים השתנה: ${srcCount} -> ${outCount}` });

  // קריאה חוזרת של כל ערך מתוכנן מול הפלט
  for (let i = 0; i < plannedRows.length; i++) {
    const r = firstRow + i;
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      const val = plannedRows[i][col];
      if (val === null || val === undefined || val === '') continue;
      const ref = `${col}${r}`;
      if (['A', 'B', 'C'].includes(col)) {
        const m = outXml.match(new RegExp(String.raw`<c r="${ref}"[^>]*t="inlineStr"><is><t>([\s\S]*?)</t></is></c>`));
        const got = m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null;
        if (got !== String(val)) errors.push({ code: 'E09', message: `ערך שגוי ב-${ref}: צפוי "${val}", התקבל ${got === null ? '(חסר)' : `"${got}"`}` });
      } else {
        const m = outXml.match(new RegExp(String.raw`<c r="${ref}"[^>]*><v>([^<]*)</v></c>`));
        const got = m ? m[1] : null;
        if (got === null || Number(got) !== Number(val)) errors.push({ code: 'E09', message: `ערך שגוי ב-${ref}: צפוי ${val}, התקבל ${got === null ? '(חסר)' : got}` });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { verify };
