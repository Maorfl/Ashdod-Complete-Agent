# התקנה והפעלה — סוכן כספי

## דרישות מקדימות
- **Node.js 20+** (נבדק על 22)
- Windows (נבדק על Windows 11). עובד גם על Linux/Mac.

## התקנה
```bash
cd caspi-agent
npm install
```
זה מתקין את התלויות לכל ה-workspaces (server + client).

## בנייה
```bash
npm run build        # בונה את ה-frontend (tsc + vite) ל-client/dist
```

## הפעלה
```bash
npm start            # מפעיל את השרת על 0.0.0.0:4000, מגיש גם את ה-frontend
```
פתחו בדפדפן: **http://localhost:4000** (או `http://<IP-של-השרת>:4000` ממחשב אחר ברשת).

## פיתוח (hot-reload)
```bash
npm run dev          # server עם --watch + vite dev server (פרוקסי ל-API)
```

## בדיקת הצנרת ללא שליחת מיילים
```bash
cd server
npm run test:pipeline
```
מריץ את כל הצנרת (reader → classifier → composer) על `data/אשדוד.xlsx`,
מדפיס סטטיסטיקת ניתוב, ובודק שכל נמען חיצוני מנותב ל-override. **לא שולח דבר.**

## ייצור נתוני יבואנים/מחלקות מהדוח
```bash
node scripts/build-importers-from-xlsx.js [נתיב-לדוח]
```
ברירת מחדל: `config.report_path`. יוצר את `data/importers/<שם>/importer.json`
ואת `data/departments/cus{1,2,3}.json`.

## נתונים ותצורה
- **דוח Focus:** `data/אשדוד.xlsx` (ניתן להצביע על תיקייה משותפת ב-`config.report_path`).
- **מעקב משלוחים:** `data/shipments.db` (SQLite, WAL). נוצר אוטומטית אם חסר.
- **תצורה:** `config/config.json`, `config/co_loaders.json`, `config/terminals.json`.
- **משתני סביבה (אופציונלי):** העתיקו `server/.env.example` ל-`server/.env`.

## הרצה ברקע / כשירות / עדכונים
ראו `packaging/README.md`.
