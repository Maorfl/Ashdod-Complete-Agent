/**
 * routes/version.js — בדיקת גרסה + שליטה ב-report watcher וב-mail tracker
 * (הרצה ידנית / סטטוס).
 */
const express = require('express');
const { checkVersion } = require('../version');
const reportWatcher = require('../services/reportWatcher');
const mailTracker = require('../services/mailTracker');
const router = express.Router();

router.get('/', async (req, res) => res.json(await checkVersion()));
router.get('/watcher', (req, res) => res.json({ last: reportWatcher.status() }));
router.post('/watcher/run', (req, res) => res.json(reportWatcher.runOnce()));
router.get('/tracker', (req, res) => res.json({ last: mailTracker.status() }));
router.post('/tracker/run', async (req, res) => res.json(await mailTracker.runOnce()));

module.exports = router;
