/**
 * routes/shipments.js — דשבורד מצבת תיקים: 5 מוני סטטוס + רשימה.
 * מאחד את הסטטוסים הלוגיים של הסוכן עם סטטוסי המעקב התפעוליים בעברית.
 */
const express = require('express');
const shipments = require('../db/shipments');
const departments = require('../db/departments');
const { composeReminder } = require('../email/composer');
const router = express.Router();

// סטטוסים מותרים לעדכון ידני מהדשבורד (whitelist)
const MANUAL_STATUSES = ['שוחרר באשדוד', 'יצא לחיפה', 'התקבל בחיפה', 'נמסר ללקוח', 'alert'];

// מיפוי סטטוסים ל-5 מונים לדשבורד
function dashboardCounts(items) {
  const c = { pending_approval: 0, released_ashdod: 0, to_haifa: 0, delivered: 0, alert: 0 };
  for (const r of items) {
    switch (r.status) {
      case 'pending_approval': c.pending_approval += 1; break;
      case 'alert': c.alert += 1; break;
      case 'sent':
      case 'שוחרר באשדוד': c.released_ashdod += 1; break;
      case 'יצא לחיפה':
      case 'התקבל בחיפה': c.to_haifa += 1; break;
      case 'נמסר ללקוח': c.delivered += 1; break;
      default: break;
    }
  }
  return c;
}

// פירוק draft_payload (JSON) לתצוגה בכרטיס התיק
function withDraft(r) {
  let draft = null;
  try { draft = r.draft_payload ? JSON.parse(r.draft_payload) : null; } catch { /* ignore */ }
  return { ...r, draft };
}

// דשבורד
router.get('/', (req, res) => {
  const items = shipments.all().map(withDraft);
  res.json({ counts: dashboardCounts(items), total: items.length, items });
});

// לקוחות מחלקה
router.get('/departments/:dept', (req, res) => res.json(departments.listClients(req.params.dept)));

// היסטוריית סטטוסים של תיק
router.get('/:file/history', (req, res) => res.json(shipments.history(req.params.file)));

// עדכון סטטוס ידני מהדשבורד — משתמש ב-setStatus הקיים (כותב ל-status_history)
router.post('/:file/status', (req, res) => {
  const { status, notes } = req.body || {};
  if (!MANUAL_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'סטטוס לא חוקי', allowed: MANUAL_STATUSES });
  }
  const rec = shipments.get(req.params.file);
  if (!rec) return res.status(404).json({ error: 'תיק לא נמצא' });
  const updated = shipments.setStatus(rec.file_number, status, notes || 'עדכון ידני מהדשבורד');
  res.json({ ok: true, status: updated.status });
});

// יצירת תזכורת — לא שולח מייל. בונה טיוטה ומחזיר את התיק לתור האישורים (human-in-the-loop).
router.post('/:file/reminder', (req, res) => {
  const rec = shipments.get(req.params.file);
  if (!rec) return res.status(404).json({ error: 'תיק לא נמצא' });
  const email = composeReminder(rec);
  shipments.upsert({
    file_number: rec.file_number,
    status: 'pending_approval',
    notes: 'תזכורת ידנית — ממתינה לאישור',
    draft_payload: { route: rec.route || 'reminder', reminder: true, email },
  });
  res.json({ ok: true, status: 'pending_approval', email });
});

// תיק בודד
router.get('/:file', (req, res) => {
  const r = shipments.get(req.params.file);
  if (!r) return res.status(404).json({ error: 'תיק לא נמצא' });
  res.json(withDraft(r));
});

module.exports = router;
