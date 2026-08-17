/**
 * routes/version.js — בדיקת גרסה + שליטה ב-report watcher וב-mail tracker
 * (הרצה ידנית / סטטוס).
 */
const express = require('express');
const { checkVersion } = require('../version');
const { config } = require('../config');
const reportWatcher = require('../services/reportWatcher');
const mailTracker = require('../services/mailTracker');
const shipments = require('../db/shipments');
const router = express.Router();

// external_email_override נחשף כאן לצורך תצוגה בלבד בלקוח (זיהוי placeholder ברשומת יבואן,
// ראו client/src/pages/Importers.tsx) — לא נוגע בהתנהגות הניתוב האמיתית ב-classifier.js.
router.get('/', async (req, res) => res.json({ ...(await checkVersion()), external_email_override: config.external_email_override }));
router.get('/watcher', (req, res) => res.json(reportWatcher.status()));
router.post('/watcher/run', async (req, res) => res.json(await reportWatcher.runNow())); // סריקה + קומיט מיידיים
router.get('/tracker', (req, res) => res.json({ last: mailTracker.status() }));
router.post('/tracker/run', async (req, res) => res.json(await mailTracker.runOnce()));
// לוג סימולציות dry_run — "מה היה נשלח" (תוספת אוטומציה, ניתנת להסרה)
router.get('/dry-run-log', (req, res) => res.json(shipments.dryRunLog(Number(req.query.limit) || 200)));

module.exports = router;
