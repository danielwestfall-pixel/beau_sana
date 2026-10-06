@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer, then open this file again.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)
node -e "if (parseInt(process.versions.node, 10) < 22) process.exit(1)"
if errorlevel 1 (
  echo Please update to Node.js 22 or newer, then open this file again.
  pause
  exit /b 1
)
node server.mjs --open
pause
