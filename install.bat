@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === התקנת סוכן כספי — checkout טרי ===
echo.
echo [1/2] מתקין תלויות (npm install)...
call npm install
if errorlevel 1 (
  echo.
  echo !!! ההתקנה נכשלה — בדקו ש-Node.js 20+ מותקן ושיש חיבור לאינטרנט.
  pause
  exit /b 1
)
echo.
echo [2/2] בונה את צד הלקוח (npm run build)...
call npm run build
if errorlevel 1 (
  echo.
  echo !!! הבנייה נכשלה — ראו את השגיאות למעלה.
  pause
  exit /b 1
)
echo.
echo === הותקן בהצלחה. להפעלה: start-server.bat ===
echo (הגדרת .env / שירות רקע / עדכונים — ראו SETUP.md ו-packaging/README.md)
pause
