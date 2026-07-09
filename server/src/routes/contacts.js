/**
 * routes/contacts.js — ניהול מסופים ומשלחים (Task 3). קורא/כותב את אותם קבצים
 * ששאר הצנרת משתמשת בהם (config/terminals.json בלוק terminals, config/co_loaders.json)
 * דרך db/contacts — מקור אמת יחיד. שינוי נכנס לתוקף בצנרת בלי restart (cache מתעדכן).
 * PUT מקבל את האובייקט המלא (כל המסופים / כל הקו-לואדרים) ומחליף את הבלוק.
 */
const express = require('express');
const contacts = require('../db/contacts');
const router = express.Router();

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

router.get('/terminals', (req, res) => res.json(contacts.terminals()));
router.put('/terminals', (req, res) => {
  if (!isPlainObject(req.body)) return res.status(400).json({ error: 'גוף לא תקין — נדרש אובייקט מסופים' });
  try { res.json(contacts.writeTerminals(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/co-loaders', (req, res) => res.json(contacts.coLoaders()));
router.put('/co-loaders', (req, res) => {
  if (!isPlainObject(req.body)) return res.status(400).json({ error: 'גוף לא תקין — נדרש אובייקט קו-לואדרים' });
  try { res.json(contacts.writeCoLoaders(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
