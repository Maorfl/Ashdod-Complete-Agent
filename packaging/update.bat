@echo off
chcp 65001 >nul
echo === עדכון סוכן כספי מ-GitHub ===
cd /d "%~dp0.."
git pull
call npm install
call npm run build
echo === מפעיל מחדש את השירות ===
net stop "Caspi Agent" 2>nul
net start "Caspi Agent" 2>nul
echo עודכן בהצלחה.
pause
