/**
 * index.js — שרת Express ראשי.
 * מאזין על 0.0.0.0 כדי לאפשר גישה מכמה מחשבים ברשת המקומית בו-זמנית.
 * מגיש את ה-API ואת ה-build של ה-React. מיועד לרוץ ברקע.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const { ROOT, PORT, HOST, config } = require('./config');
const reportWatcher = require('./services/reportWatcher');
const mailTracker = require('./services/mailTracker');
const gatepassFetcher = require('./services/gatepassFetcher');
const retention = require('./services/retention');
const dailyReport = require('./services/dailyReport');
const graph = require('./services/graphMail');
const { checkVersion } = require('./version');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api/importers', require('./routes/importers'));
app.use('/api/shipments', require('./routes/shipments'));
app.use('/api/approvals', require('./routes/approvals'));
app.use('/api/sent-emails', require('./routes/sentEmails'));
app.use('/api', require('./routes/contacts')); // /api/terminals + /api/co-loaders
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

// כתובות ה-IPv4 האמיתיות של המחשב ברשת (ללא loopback/פנימיים) — לבאנר ההפעלה,
// כדי שהמשתמש יקבל כתובת אמיתית לשיתוף עם מחשבים אחרים במקום placeholder.
function lanAddresses() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

app.listen(PORT, HOST, async () => {
  console.log('\n  סוכן כספי — שרת פעיל');
  console.log(`  מקומי:  http://localhost:${PORT}`);
  const ips = lanAddresses();
  if (ips.length) {
    for (const ip of ips) console.log(`  רשת:    http://${ip}:${PORT}  (נגיש ממחשבים אחרים ברשת)`);
  } else {
    console.log('  רשת:    לא זוהתה כתובת רשת חיצונית (אין ממשק רשת פעיל?)');
  }
  console.log('  הערה: לגישה ממחשבים אחרים ייתכן שנדרש לפתוח את הפורט ב-Windows Firewall — ראו SETUP.md.');
  if (config.github?.check_on_startup) {
    const v = await checkVersion().catch(() => null);
    if (v?.update_required) console.log(`  ⚠️ עדכון זמין: ${v.current} → ${v.latest}`);
    else if (v?.source === 'not_configured') console.log('  (בדיקת גרסה: github.owner לא הוגדר)');
  }
  reportWatcher.start();
  console.log(`  Report Watcher פעיל (כל ${config.poll_interval_minutes} דק').`);
  retention.start();
  console.log(`  Retention פעיל — תיקים שנמסרו: יומי; קבצי PDF: יומי ב-0${config.retention?.pdf_cleanup_hour ?? 7}:00 (ישן מ-${config.retention?.delivered_days ?? 21} יום).`);
  if (graph.isEnabled()) {
    mailTracker.start();
    gatepassFetcher.start();
    console.log(`  Microsoft Graph מחובר — שליחה באישור + מעקב הגעות + איתור gatepass (כל ${graph.settings().pollMinutes} דק').`);
    if (dailyReport.isEnabled()) {
      dailyReport.start();
      console.log('  דוח מחלקתי פעיל — "יצא לחיפה" 2+ ימים פעמיים ביום (09:00, 15:00) + סיכום מונים יומי ב-15:00.\n');
    } else {
      console.log('  דוח מחלקתי כבוי (feature_flags.daily_report=false).\n');
    }
  } else {
    console.log('  Microsoft Graph כבוי — אישור מסמן נשלח בלבד; איתור gatepass ומעקב הגעות מושבתים.\n');
  }
});
