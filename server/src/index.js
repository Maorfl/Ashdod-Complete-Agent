/**
 * index.js — שרת Express ראשי.
 * מאזין על 0.0.0.0 כדי לאפשר גישה מכמה מחשבים ברשת המקומית בו-זמנית.
 * מגיש את ה-API ואת ה-build של ה-React. מיועד לרוץ ברקע.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { ROOT, PORT, HOST, config } = require('./config');
const reportWatcher = require('./services/reportWatcher');
const mailTracker = require('./services/mailTracker');
const graph = require('./services/graphMail');
const { checkVersion } = require('./version');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api/importers', require('./routes/importers'));
app.use('/api/shipments', require('./routes/shipments'));
app.use('/api/approvals', require('./routes/approvals'));
app.use('/api/version', require('./routes/version'));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// הגשת ה-frontend לאחר build
const clientDist = path.join(ROOT, 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
  const indexHtml = path.join(clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml);
  res.status(200).send('צד הלקוח טרם נבנה (npm run build). השרת פעיל, ה-API זמין תחת /api');
});

app.listen(PORT, HOST, async () => {
  console.log('\n  סוכן כספי — שרת פעיל');
  console.log(`  מקומי:  http://localhost:${PORT}`);
  console.log(`  רשת:    http://<IP-של-השרת>:${PORT}  (נגיש מכמה מחשבים)`);
  if (config.github?.check_on_startup) {
    const v = await checkVersion().catch(() => null);
    if (v?.update_required) console.log(`  ⚠️ עדכון זמין: ${v.current} → ${v.latest}`);
    else if (v?.source === 'not_configured') console.log('  (בדיקת גרסה: github.owner לא הוגדר)');
  }
  reportWatcher.start();
  console.log(`  Report Watcher פעיל (כל ${config.poll_interval_minutes} דק').`);
  if (graph.isEnabled()) {
    mailTracker.start();
    console.log(`  Microsoft Graph מחובר — שליחה באישור + מעקב הגעות (כל ${graph.settings().pollMinutes} דק').\n`);
  } else {
    console.log('  Microsoft Graph כבוי — אישור מסמן נשלח בלבד, ללא שליחה בפועל.\n');
  }
});
