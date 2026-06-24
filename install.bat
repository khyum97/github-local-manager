@echo off
title GitHub Local Manager Installer
cd /d "%~dp0"

echo [System] Installing Node.js dependencies (Express)...
call npm install

echo.
echo [System] Installation completed successfully!
echo [System] Creating Desktop Shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut(\"$Home\Desktop\GitHub Local Manager.lnk\"); $Shortcut.TargetPath = '%~dp0run.bat'; $Shortcut.WorkingDirectory = '%~dp0.'; $Shortcut.Description = 'Launch GitHub Local Manager'; $Shortcut.IconLocation = '%~dp0github-rainbow-v3.ico'; $Shortcut.Save()"
echo [System] Shortcut created on Desktop: 'GitHub Local Manager'
echo.
echo [System] Now you can start the application by double-clicking the shortcut on your Desktop or 'run.bat' in this folder.
echo.
pause
