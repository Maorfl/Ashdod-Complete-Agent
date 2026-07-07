/**
 * routes/sentEmails.js — "מיילים שנשלחו": לוג append-only של כל מייל שנשלח בפועל
 * דרך Microsoft Graph (אישור אנושי או שליחה אוטומטית). לא נגזר מ-draft_payload.
 */
const express = require('express');
const shipments = require('../db/shipments');
const router = express.Router();

// חדש → ישן. to/cc שמורים כ-JSON — מפורקים כאן לתצוגה נוחה בצד הלקוח.
router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = shipments.sentEmails(limit).map((r) => {
    const parse = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
    return { ...r, to_addresses: parse(r.to_addresses), cc_addresses: parse(r.cc_addresses) };
  });
  res.json(rows);
});

module.exports = router;
