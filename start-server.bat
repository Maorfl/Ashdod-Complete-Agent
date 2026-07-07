@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === סוכן כספי — הפעלת השרת ===
echo (החלון נשאר פתוח כדי שהלוגים יהיו גלויים. לעצירה: Ctrl+C או סגירת החלון)
echo.
call npm start
echo.
echo === השרת נעצר (קוד יציאה: %errorlevel%) ===
pause
