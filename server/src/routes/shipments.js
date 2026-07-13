/**
 * routes/shipments.js — דשבורד מצבת תיקים: 5 מוני סטטוס + רשימה.
 * מאחד את הסטטוסים הלוגיים של הסוכן עם סטטוסי המעקב התפעוליים בעברית.
 */
const express = require('express');
const shipments = require('../db/shipments');
const departments = require('../db/departments');
const { composeReminder } = require('../email/composer');
const gatepassFetcher = require('../services/gatepassFetcher');
const scope = require('../scope');
const { config } = require('../config');
const router = express.Router();

// סטטוסים מותרים לעדכון ידני מהדשבורד (whitelist)
const MANUAL_STATUSES = ['שוחרר באשדוד', 'יצא לחיפה', 'התקבל בחיפה', 'נמסר ללקוח', 'alert'];

// מיפוי סטטוסים ל-5 מונים לדשבורד
function dashboardCounts(items) {
  const c = { awaiting_pdf: 0, pending_approval: 0, in_transit: 0, arrived_haifa: 0, delivered: 0, alert: 0 };
  for (const r of items) {
    switch (r.status) {
      case 'ממתין ל-PDF': c.awaiting_pdf += 1; break;
      case 'pending_approval': c.pending_approval += 1; break;
      case 'alert': c.alert += 1; break;
      case 'sent':
      case 'שוחרר באשדוד':
      case 'יצא לחיפה': c.in_transit += 1; break;   // בדרך לחיפה
      case 'התקבל בחיפה': c.arrived_haifa += 1; break; // הגיע לחיפה
      case 'נמסר ללקוח': c.delivered += 1; break;
      default: break;
    }
  }
  return c;
}

// פירוק draft_payload (JSON) + סימון whitelisted (defense in depth): מקור אמת יחיד
// (scope.js) — לא סומכים על department לבד. + real_recipients: הטיוטה נושאת נמענים
// אמיתיים (לא override) — מוצג בכרטיס התיק שהמאשר לא יופתע.
function withDraft(r) {
  let draft = null;
  try { draft = r.draft_payload ? JSON.parse(r.draft_payload) : null; } catch { /* ignore */ }
  const to = draft?.email?.to || [];
  const realRecipients = to.some((a) => a && a !== config.external_email_override);
  return { ...r, draft, whitelisted: scope.isWhitelisted(r.customer_name), real_recipients: realRecipients };
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
  const { notes } = req.body || {};
  const email = composeReminder(rec, notes);
  shipments.upsert({
    file_number: rec.file_number,
    status: 'pending_approval',
    notes: notes || 'תזכורת ידנית — ממתינה לאישור',
    draft_payload: { route: rec.route || 'reminder', reminder: true, email },
  });
  res.json({ ok: true, status: 'pending_approval', email });
});

// עדכון הערות לתיק בלבד
router.post('/:file/notes', (req, res) => {
  const { notes } = req.body || {};
  const rec = shipments.get(req.params.file);
  if (!rec) return res.status(404).json({ error: 'תיק לא נמצא' });
  const updated = shipments.upsert({
    file_number: rec.file_number,
    notes: notes ?? '',
  });
  res.json({ ok: true, notes: updated.notes });
});

// איתור ידני של ה-gatepass PDF עבור תיק (Task 6) — לא חוסם אישור
router.post('/:file/gatepass', async (req, res) => {
  const rec = shipments.get(req.params.file);
  if (!rec) return res.status(404).json({ error: 'תיק לא נמצא' });
  try {
    const r = await gatepassFetcher.fetchForFile(rec.file_number);
    res.json({ ok: !!r.path, ...r });
  } catch (e) {
    res.status(502).json({ error: `איתור PDF נכשל: ${e.message}` });
  }
});

// תיק בודד
router.get('/:file', (req, res) => {
  const r = shipments.get(req.params.file);
  if (!r) return res.status(404).json({ error: 'תיק לא נמצא' });
  res.json(withDraft(r));
});

module.exports = router;
