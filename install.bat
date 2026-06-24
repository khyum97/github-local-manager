@echo off
title GitHub Local Manager Installer
cd /d "%~dp0"

echo [System] Installing Node.js dependencies (Express)...
call npm install

echo.
echo [System] Installation completed successfully!
echo [System] Now you can close this window and double-click 'run.bat' to start the application.
echo.
pause
