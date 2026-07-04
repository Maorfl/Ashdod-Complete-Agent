# אריזה, הרצה ברקע ועדכונים

## 1. הרצה ברקע — שלוש אפשרויות

### אפשרות א׳ (הכי פשוטה): `start-background.vbs`
לחיצה כפולה על `packaging/start-background.vbs` מריצה את השרת ברקע ללא חלון מסוף.
לעצירה: סגירת תהליך `node.exe` מ-Task Manager.

### אפשרות ב׳: שירות Windows (עולה אוטומטית אחרי ריבוט)
```bash
cd packaging
npm install node-windows
node install-service.js        # מתקין ומפעיל את השירות "Caspi Agent"
```
השירות יעלה אוטומטית עם הפעלת המחשב ויאזין על הפורט שב-`config.json` (4000).
הסרה: `node uninstall-service.js` (אם נוצר) או דרך `services.msc`.

### אפשרות ג׳: EXE עצמאי (`pkg`)
```bash
npm install -g pkg
npm run build                  # בונה את ה-frontend ל-client/dist
cd server
pkg . --targets node18-win-x64 --output ../dist/caspi-agent.exe
```
⚠️ `better-sqlite3` הוא מודול נייטיב — יש לוודא שקובץ ה-`.node`
(`node_modules/better-sqlite3/build/Release/better_sqlite3.node`) ו-`client/dist`
ו-`config/` נארזים/מוצבים לצד ה-EXE.

## 2. גישה מכמה מחשבים בו-זמנית
השרת מאזין על `0.0.0.0` (`config.server.host`). כל עמדה ברשת ניגשת בדפדפן ל-
`http://<IP-של-שרת-האירוח>:4000` — ללא התקנה מקומית. SQLite פועל ב-WAL לקריאות
מקבילות. מומלץ לקבע IP סטטי לשרת ולפתוח את פורט 4000 ב-Firewall של Windows.

## 3. מנגנון עדכון דרך GitHub
- בעליית השרת נבדקת הגרסה מול ה-release האחרון ב-GitHub
  (`config.github.owner/repo` מול `config.github.current_version`).
  אם מאחור — מוצגת התראת "עדכון זמין" בממשק ובלוג.
- לעדכון בפועל הריצו `packaging/update.bat`: מבצע `git pull` → `npm install` →
  `npm run build` → הפעלה מחדש של השירות.
- כל עוד `github.owner` לא הוגדר, בדיקת הגרסה מחזירה `not_configured` (לא חוסמת).
