@echo off
title GitHub Local Manager
cd /d "%~dp0"

echo [System] Starting Node.js server...
echo [System] The app will open automatically in your default browser at http://localhost:3000
echo.

call npm start

pause
