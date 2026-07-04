' מריץ את שרת הסוכן ברקע ללא חלון מסוף.
' לחיצה כפולה על הקובץ מפעילה את השרת שקט. נגיש בדפדפן ב-http://<IP>:4000
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = projectDir
sh.Run "cmd /c npm start", 0, False
