@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js first, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\mysql2\package.json" (
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm.cmd start
if errorlevel 1 pause
