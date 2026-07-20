/**
 * routes/approvals.js — תור אישורי המחלקות (human-in-the-loop).
 * שום מייל לא נשלח ללא אישור אנושי. אישור => הסוכן מסמן 'sent' (owns_file).
 */
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const shipments = require('../db/shipments');
const graph = require('../services/graphMail');
const gatepassFetcher = require('../services/gatepassFetcher');
const { toBodyHtml } = require('../email/composer');
const { requiresGatepass } = require('../report/classifier');
const scope = require('../scope');
const { config } = require('../config');
const router = express.Router();

// העלאת gatepass PDF ידנית — בזיכרון בלבד (עד 15MB), נשמר דרך gatepassFetcher
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// האם לתיק זה נדרש gatepass PDF לפני שליחה? (מסלולי ההעברה לחיפה; לא תזכורות)
function needsGatepass(rec, payload) {
  if (payload && payload.reminder) return false;
  const route = (payload && payload.route) || rec.route;
  return requiresGatepass(route);
}
function hasGatepass(rec) {
  return !!(rec.gatepass_pdf_path && fs.existsSync(rec.gatepass_pdf_path));
}

// פירוק draft_payload (JSON) + סימון whitelisted (defense in depth, מקור אמת יחיד scope.js)
// + real_recipients: הטיוטה נושאת נמענים אמיתיים (לא override) — שהמאשר לא יופתע.
function withDraft(r) {
  let draft = null;
  try {
    draft = r.draft_payload ? JSON.parse(r.draft_payload) : null;
  } catch { /* ignore */ }
  const to = draft?.email?.to || [];
  const realRecipients = to.some((a) => a && a !== config.external_email_override);
  return { ...r, draft, whitelisted: scope.isWhitelisted(r.customer_name), real_recipients: realRecipients };
}

// תור אישורים — תיקים שממתינים להחלטת מחלקה. טיוטת העברה לחיפה ללא gatepass PDF
// לעולם אינה מופיעה כאן (היא מוחזקת במצב "ממתין ל-PDF" ונראית רק בדשבורד/כרטיס);
// הסינון כאן הוא הגנה נוספת גם על רשומות ישנות שנותרו ב-pending_approval בלי PDF.
router.get('/', (req, res) => {
  const list = shipments.byStatus('pending_approval')
    .map(withDraft)
    .filter((r) => !needsGatepass(r, r.draft) || hasGatepass(r));
  res.json(list);
});

// תיק בודד עם הטיוטה
router.get('/:file', (req, res) => {
  const r = shipments.get(req.params.file);
  if (!r) return res.status(404).json({ error: 'תיק לא נמצא' });
  res.json(withDraft(r));
});

// ניקוי עריכת מייל נכנסת: to/cc חייבים להיות מערכי מחרוזות לא-ריקות
function sanitizeEdited(edited) {
  const clean = { ...edited };
  for (const k of ['to', 'cc']) {
    if (k in clean) {
      if (!Array.isArray(clean[k])) { delete clean[k]; continue; }
      clean[k] = clean[k].map((a) => String(a).trim()).filter(Boolean);
    }
  }
  return clean;
}

/**
 * mergeEditedEmail — ממזג עריכה לתוך email קיים, ותמיד משאיר bodyHtml מסונכרן עם body.
 * הבאג שתוקן (2026-07-15): graphMail.sendMail מעדיף bodyHtml על פני body כשקיים
 * (composer.toBodyHtml מייצר אותו בזמן הרכבת הטיוטה) — עריכת body בלבד השאירה את
 * ה-bodyHtml הישן, כך שהשליחה בפועל תמיד יצאה עם הטקסט המקורי, לא הערוך. מחדשים
 * bodyHtml מה-body הערוך רק כשה-email המקורי כבר נשא bodyHtml (כלומר, נועד להישלח
 * כ-HTML) — מיילים שמלכתחילה טקסט-בלבד (prepaid/direct/reminder) נשארים טקסט.
 */
function mergeEditedEmail(email, edited) {
  const clean = sanitizeEdited(edited);
  const merged = { ...(email || {}), ...clean };
  if ('body' in clean && email?.bodyHtml) merged.bodyHtml = toBodyHtml(merged.body);
  return merged;
}

// החלטת מחלקה: approve | reject | edit
router.post('/:file/decision', async (req, res) => {
  const { decision, edited, notes } = req.body || {};
  const rec = shipments.get(req.params.file);
  if (!rec) return res.status(404).json({ error: 'תיק לא נמצא' });

  if (decision === 'approve') {
    // נקודת השליחה בפועל — Microsoft Graph מ-ashdod.agent@. שליחה אך ורק לאחר אישור אנושי.
    let payload = {};
    try { payload = rec.draft_payload ? JSON.parse(rec.draft_payload) : {}; } catch { payload = {}; }
    // עריכות אחרונות (to/cc/body) שהגיעו עם האישור עצמו — ממוזגות ונשמרות לפני
    // השליחה, בבקשה אחת אטומית (לא edit ואז approve נפרדים שעלולים להתפצל).
    if (edited && payload.email) {
      payload.email = mergeEditedEmail(payload.email, edited);
      shipments.upsert({ file_number: rec.file_number, draft_payload: payload });
    }
    const email = payload.email;

    // חסימת שליחה בלי gatepass PDF (Task 5, החלטת משתמש 2026-07-13): מיילי ההעברה
    // לחיפה חייבים צרופת gatepass. אין PDF (או שנמחק מהדיסק) → דוחים במקום לשלוח בלי צרופה.
    // ניתן לצרף ידנית דרך POST /approvals/:file/gatepass-upload.
    if (needsGatepass(rec, payload) && !hasGatepass(rec)) {
      return res.status(400).json({ error: 'לא ניתן לשלוח ללא gatepass PDF — נא לצרף ידנית (העלאת קובץ) או להמתין לקבלתו.', missing_gatepass: true });
    }

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
      // לוג "מיילים שנשלחו" — העתק היסטורי מדויק כפי שנשלח (append-only)
      shipments.logSentEmail({ file_number: rec.file_number, customer_name: rec.customer_name, route: rec.route, email: outgoing, auto: false });
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
    if (edited) {
      // עריכת נמענים (to/cc) — אפשרות זמנית: קיימת כי השליחה עדיין בשער אישור אנושי.
      // בתוכנית עתידית של שליחה אוטומטית מלאה ייתכן שהעריכה הידנית תוסר/תצטמצם.
      payload.email = mergeEditedEmail(payload.email, edited);
    }
    shipments.upsert({ file_number: rec.file_number, status: 'pending_approval', draft_payload: payload, notes: notes || rec.notes });
    return res.json({ ok: true, status: 'edited' });
  }

  res.status(400).json({ error: 'החלטה לא חוקית (approve|reject|edit)' });
});

// העלאת gatepass PDF ידנית לתיק (Task 5) — כשה-PDF לא הגיע אוטומטית מ-do-not-reply.
// שומר לפי אותה מוסכמת נתיב כמו הצרופה הנכנסת ומעדכן gatepass_pdf_path.
router.post('/:file/gatepass-upload', upload.single('file'), (req, res) => {
  const rec = shipments.get(req.params.file);
  if (!rec) return res.status(404).json({ error: 'תיק לא נמצא' });
  if (!req.file || !req.file.buffer?.length) return res.status(400).json({ error: 'לא צורף קובץ' });
  // אימות PDF: סוג MIME או חתימת הקובץ (%PDF-) — לא סומכים על הסיומת בלבד
  const buf = req.file.buffer;
  const isPdf = req.file.mimetype === 'application/pdf' || buf.slice(0, 5).toString('latin1') === '%PDF-';
  if (!isPdf) return res.status(400).json({ error: 'הקובץ אינו PDF תקין' });
  try {
    const dest = gatepassFetcher.saveUploadedPdf(rec.file_number, buf, req.file.originalname);
    res.json({ ok: true, path: dest });
  } catch (e) {
    res.status(500).json({ error: `שמירת ה-PDF נכשלה: ${e.message}` });
  }
});

module.exports = router;
