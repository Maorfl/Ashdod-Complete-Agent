/**
 * maslul/pairResolver.js — זיהוי זוג יבואן+ספק ובחירת פרופיל (מפרט §4).
 * התאמה לפי מזהים מוגדרים בפרופיל בלבד — לא ניחוש, לא השאלה בין זוגות.
 */
const { listProfiles, getProfile } = require('./profiles');

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * resolve — מאתר פרופיל לפי טקסט הספק (מהכותרת/OCR) ואופציונלית pairId מפורש.
 * אין התאמה => E01 (בקשת בוטסטראפ), כלומר לא מפיקים כלום.
 */
function resolve({ supplierText, pairId }) {
  if (pairId) {
    const p = getProfile(pairId);
    if (p) return { ok: true, profile: p };
    return { ok: false, errors: [{ code: 'E01', message: `פרופיל לא נמצא: ${pairId}` }] };
  }

  const hay = norm(supplierText);
  for (const p of listProfiles()) {
    for (const m of p.supplier?.match || []) {
      if (hay.includes(norm(m))) return { ok: true, profile: p };
    }
  }
  return {
    ok: false,
    errors: [{
      code: 'E01',
      message: `לא נמצא פרופיל מיפוי לספק ${supplierText ? `"${supplierText}"` : '(לא זוהה)'} — נדרש תהליך בוטסטראפ (בקשה מאושרת + החשבון שממנו הופקה + התבנית).`,
    }],
  };
}

module.exports = { resolve, norm };
