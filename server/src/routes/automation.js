/**
 * routes/automation.js — קריאה/כתיבה של מצב האוטומציה (per-department + kill switch).
 * נקרא/נכתב חי מ-data/automation.json (services/automation.js) — משפיע על הקומיט
 * הבא מיד, בלי restart לשרת.
 */
const express = require('express');
const automation = require('../services/automation');
const router = express.Router();

const MODES = new Set(['off', 'dry_run', 'on']);

router.get('/', (req, res) => res.json(automation.getState()));

router.put('/department/:dept', (req, res) => {
  const { dept } = req.params;
  const { mode } = req.body || {};
  if (!automation.DEPTS.includes(dept)) return res.status(404).json({ error: 'מחלקה לא מוכרת' });
  if (!MODES.has(mode)) return res.status(400).json({ error: 'מצב לא חוקי — off/dry_run/on בלבד' });
  res.json(automation.setDepartmentMode(dept, mode));
});

router.put('/kill-switch', (req, res) => {
  const { on } = req.body || {};
  res.json(automation.setKillSwitch(!!on));
});

module.exports = router;
