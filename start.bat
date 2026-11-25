@echo off
setlocal
cd /d "%~dp0"
title Gemini Gateway Launcher

if not exist "node_modules" (
  echo [INFO] Installing dependencies via npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

:menu
cls
echo ============================================
echo          Gemini Web2API Gateway
echo ============================================
echo.
echo   [1] Local   - Gateway :8081 + Web :3000
echo   [2] Online  - Gateway :8081 + Web :3000 + ngrok
echo   [0] Exit
echo.
set "choice="
set /p choice="Select mode (1/2/0): "
if defined choice set "choice=%choice: =%"

if "%choice%"=="1" goto local
if "%choice%"=="2" goto online
if "%choice%"=="0" exit /b 0
goto menu

:local
echo.
echo [START] Starting local mode...
echo Web UI:      http://localhost:3000
echo Gateway API: http://localhost:8081/v1
echo.
call npm run dev
pause
exit /b 0

:online
where ngrok >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] ngrok not found in PATH.
  echo Install: winget install Ngrok.Ngrok
  echo Then run: ngrok update ^&^& ngrok config add-authtoken YOUR_TOKEN
  echo.
  pause
  goto menu
)

echo.
echo [START] Starting Gateway + Web in a new window...
start "Gemini Gateway" cmd /k "npm run dev"

timeout /t 2 /nobreak >nul

echo [START] Starting ngrok tunnel for port 8081...
echo Web UI remains local: http://localhost:3000
echo Public URL will appear in the ngrok window.
echo.
if defined NGROK_DOMAIN (
  start "ngrok Tunnel" cmd /k "ngrok http --domain=%NGROK_DOMAIN% 8081"
) else (
  start "ngrok Tunnel" cmd /k "ngrok http 8081"
)
exit /b 0
