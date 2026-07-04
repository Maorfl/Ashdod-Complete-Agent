# סוכן כספי (Caspi Agent)

מערכת אוטומציה פנימית לחברת שילוח ועמילות מכס (ה.כספי) לניהול תהליך **שחרור
המטענים בנמל אשדוד וההעברה לחיפה**. רצה מקומית על שרת פנימי, נגישה ממספר מחשבים
ברשת בו-זמנית דרך הדפדפן.

## עקרונות-על
- **אפס תלות ב-LLM בזמן ריצה** — לוגיקה דטרמיניסטית בלבד (SheetJS ל-Excel, tesseract.js ל-OCR). עץ החלטה קשיח.
- **Human-in-the-loop** — שום מייל חיצוני לא נשלח ללא אישור אנושי בעמוד האישורים.
- **RTL מלא**, תוכן דומיין בעברית, מזהים טכניים באנגלית.
- **Override נמענים חיצוניים** — כל נמען חיצוני (יבואנים/מובילים/מסופים) מנותב ל-`maorfl14@gmail.com`. מיילי המערכת הפנימיים (שולח + CC) נשמרים כפי שהם.

## ארכיטקטורה
| שכבה | טכנולוגיה |
|------|-----------|
| Frontend | React + TypeScript + Vite (RTL) |
| Backend | Node.js + Express (JavaScript) |
| מעקב משלוחים | SQLite (`better-sqlite3`, WAL) |
| יבואנים + מחלקות | קבצי JSON לוקאליים |
| קריאת Excel | `xlsx` (SheetJS) |
| OCR (מקרי קצה) | `tesseract.js` (heb+eng) |
| מבנה | npm workspaces |

## עץ ההחלטה (classifier) — first match wins
1. **no_op** — `Customs Station Code` ≠ 2 (לא אשדוד).
2. **prepaid** — `Inter. Forwarder` אינו כספי → היבואן מטפל ישירות.
3. **co_loader** — קיים `Co Loader Code` → ניתוב למוביל המאחד (`co_loaders.json`).
4. **terminal** — אין קוד → ניתוב למסוף לפי `Cust. Stor. Site Des` (`terminals.json`).
5. **direct** — יבואן מסוג `direct` → שחרור ישיר.
6. **alert** — קוד/מסוף לא מזוהה → בדיקה ידנית, לא נשלח.

**מטען מסוכן:** כשמסומן Hazardous, מוביל ההמשך לחיפה עובר אוטומטית מ-גולד בונד ל-**סמא**.

## עמודים
- **דשבורד מטענים** — 5 מוני סטטוס + מצבת תיקים.
- **אישורי שליחה** — אישור/עריכה/דחייה של טיוטות מייל לפני שליחה.
- **ניהול יבואנים** — CRUD מלא, נשמר ל-`importer.json` של כל יבואן.

## API
| Method | Path | תיאור |
|--------|------|-------|
| GET | `/api/health` | בדיקת חיות |
| GET | `/api/shipments` | דשבורד: 5 מונים + רשימה |
| GET | `/api/shipments/:file/history` | היסטוריית סטטוסים |
| GET | `/api/approvals` | תור אישורים (עם טיוטות) |
| POST | `/api/approvals/:file/decision` | `approve` \| `edit` \| `reject` |
| GET/POST/PUT/DELETE | `/api/importers[/:folder]` | CRUD יבואנים |
| GET | `/api/version` | בדיקת גרסה מול GitHub |
| POST | `/api/version/watcher/run` | הרצת סריקת דוח ידנית |

## התקנה והרצה
ראו [SETUP.md](SETUP.md). בקצרה:
```bash
npm install && npm run build && npm start   # http://localhost:4000
```

## פערים פתוחים (OPEN GAPS)
- פרטי קשר אמיתיים לקודי קו-לואדר `635/674/15373` ולמסופים `bonded/swissport` — כרגע `needs_review:true` + override.
- מיפוי `type` לכל יבואן — מושלם דרך עמוד ניהול היבואנים (כעת `unknown`).
- סייטים לא ממופים (`נמל אשדוד` ועוד) — נופלים ל-`alert` (בדיקה ידנית) עד מיפוי ב-`terminals.json`.
- `Inter. Forwarder` ריק = כספי — הנחה הניתנת לשינוי ב-`config.empty_forwarder_is_caspi`.
