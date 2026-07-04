// מתקין את שרת הסוכן כשירות Windows שרץ ברקע (node-windows).
// דרישה מוקדמת: npm install -g node-windows  (או התקנה מקומית בתיקיית packaging).
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'Caspi Agent',
  description: 'סוכן אוטומציה לשחרור מטענים אשדוד ← חיפה (ה.כספי)',
  script: path.join(__dirname, '..', 'server', 'src', 'index.js'),
  nodeOptions: [],
  workingDirectory: path.join(__dirname, '..'),
});

svc.on('install', () => {
  console.log('השירות "Caspi Agent" הותקן. מפעיל…');
  svc.start();
});
svc.on('alreadyinstalled', () => console.log('השירות כבר מותקן.'));
svc.on('start', () => console.log('השירות פעיל ומאזין על הפורט שב-config.json (4000).'));

svc.install();
