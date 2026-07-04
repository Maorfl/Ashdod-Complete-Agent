/**
 * routes/importers.js — CRUD מלא ליבואנים (נשמר ל-JSON בתיקיות data/importers).
 */
const express = require('express');
const importers = require('../db/importers');
const router = express.Router();

// רשימת כל היבואנים
router.get('/', (req, res) => res.json(importers.list()));

// יבואן בודד לפי תיקיה
router.get('/:folder', (req, res) => {
  const imp = importers.readByFolder(req.params.folder);
  if (!imp) return res.status(404).json({ error: 'יבואן לא נמצא' });
  res.json(imp);
});

// יצירת יבואן חדש
router.post('/', (req, res) => {
  try {
    res.status(201).json(importers.create(req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// עריכת נתוני יבואן (מיילים, הערות, כתובת, type, מחלקה, וכו')
router.put('/:folder', (req, res) => {
  try {
    res.json(importers.update(req.params.folder, req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// מחיקת יבואן
router.delete('/:folder', (req, res) => {
  try {
    res.json(importers.remove(req.params.folder));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
