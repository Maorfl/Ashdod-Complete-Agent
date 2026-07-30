/**
 * routes/version.js — בדיקת גרסה + שליטה ב-report watcher וב-mail tracker
 * (הרצה ידנית / סטטוס).
 */
const express = require('express');
const { checkVersion } = require('../version');
const reportWatcher = require('../services/reportWatcher');
const mailTracker = require('../services/mailTracker');
const shipments = require('../db/shipments');
const router = express.Router();

router.get('/', async (req, res) => res.json(await checkVersion()));
router.get('/watcher', (req, res) => res.json(reportWatcher.status()));
router.post('/watcher/run', async (req, res) => res.json(await reportWatcher.runNow())); // סריקה + קומיט מיידיים
router.get('/tracker', (req, res) => res.json({ last: mailTracker.status() }));
router.post('/tracker/run', async (req, res) => res.json(await mailTracker.runOnce()));
// לוג סימולציות dry_run — "מה היה נשלח" (תוספת אוטומציה, ניתנת להסרה)
router.get('/dry-run-log', (req, res) => res.json(shipments.dryRunLog(Number(req.query.limit) || 200)));

module.exports = router;
