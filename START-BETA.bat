@echo off
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.13 or later is required.
  pause
  exit /b 1
)
pushd "%~dp0"
set PORT=3198
start "MANGAN Beta Server" cmd /k node server.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:3198"
popd
