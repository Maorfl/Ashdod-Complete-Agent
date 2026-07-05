/**
 * routes/approvals.js — תור אישורי המחלקות (human-in-the-loop).
 * שום מייל לא נשלח ללא אישור אנושי. אישור => הסוכן מסמן 'sent' (owns_file).
 */
const express = require('express');
const shipments = require('../db/shipments');
const graph = require('../services/graphMail');
const router = express.Router();

// פירוק draft_payload (JSON) לתצוגת המייל המוצע
function withDraft(r) {
  let draft = null;
  try {
    draft = r.draft_payload ? JSON.parse(r.draft_payload) : null;
  } catch { /* ignore */ }
  return { ...r, draft };
}

// תור אישורים — תיקים שממתינים להחלטת מחלקה
router.get('/', (req, res) => {
  res.json(shipments.byStatus('pending_approval').map(withDraft));
});

// תיק בודד עם הטיוטה
router.get('/:file', (req, res) => {
  const r = shipments.get(req.params.file);
  if (!r) return res.status(404).json({ error: 'תיק לא נמצא' });
  res.json(withDraft(r));
});

// החלטת מחלקה: approve | reject | edit
router.post('/:file/decision', async (req, res) => {
  const { decision, edited, notes } = req.body || {};
  const rec = shipments.get(req.params.file);
  if (!rec) return res.status(404).json({ error: 'תיק לא נמצא' });

  if (decision === 'approve') {
    // נקודת השליחה בפועל — Microsoft Graph מ-ashdod.agent@. שליחה אך ורק לאחר אישור אנושי.
    let payload = {};
    try { payload = rec.draft_payload ? JSON.parse(rec.draft_payload) : {}; } catch { payload = {}; }
    const email = payload.email;

    if (graph.isEnabled() && graph.settings().sendOnApprove && email) {
      // צירוף ה-gatepass PDF שאותר עבור התיק, אם קיים (Task 6)
      const outgoing = rec.gatepass_pdf_path
        ? { ...email, attachments: [rec.gatepass_pdf_path] }
        : email;
      try {
        await graph.sendMail(outgoing);
      } catch (e) {
        // שליחה נכשלה — התיק נשאר בתור, לא מסומן כנשלח
        return res.status(502).json({ error: `השליחה נכשלה: ${e.message}` });
      }
      const updated = shipments.markSent(rec.file_number, notes || 'אושר ונשלח דרך Microsoft Graph');
      return res.json({ ok: true, status: updated.status, sent: true });
    }

    // Graph כבוי/לא מוגדר — סימון בלבד (התנהגות קודמת)
    const updated = shipments.markSent(rec.file_number, notes || 'אושר ונשלח');
    return res.json({ ok: true, status: updated.status, sent: false });
  }

  if (decision === 'reject') {
    shipments.setStatus(rec.file_number, 'rejected', notes || 'נדחה ע"י המחלקה');
    return res.json({ ok: true, status: 'rejected' });
  }

  if (decision === 'edit') {
    let payload = {};
    try { payload = rec.draft_payload ? JSON.parse(rec.draft_payload) : {}; } catch { payload = {}; }
    if (edited) payload.email = { ...(payload.email || {}), ...edited };
    shipments.upsert({ file_number: rec.file_number, status: 'pending_approval', draft_payload: payload, notes: notes || rec.notes });
    return res.json({ ok: true, status: 'edited' });
  }

  res.status(400).json({ error: 'החלטה לא חוקית (approve|reject|edit)' });
});

module.exports = router;
