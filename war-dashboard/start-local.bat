@echo off
cd /d C:\Users\lenovo\war-dashboard\war-dashboard
 
start "API" cmd /k "cd /d C:\Users\lenovo\war-dashboard\war-dashboard && node server.js"
start "WEB" cmd /k "cd /d C:\Users\lenovo\war-dashboard\war-dashboard && npm run dev"
 
timeout /t 8 >nul
start http://localhost:3002