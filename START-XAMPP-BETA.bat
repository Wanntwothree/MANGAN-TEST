@echo off
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.13 or later is required.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://localhost:8080/' -UseBasicParsing -Method Head -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Apache is not serving http://localhost:8080.
  echo Start Apache from the XAMPP Control Panel, then run this file again.
  pause
  exit /b 1
)

pushd "%~dp0"
start "MANGAN Beta Server" cmd /k node server.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:8080"
popd
