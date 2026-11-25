@echo off
chcp 65001 >nul
cd /d "%~dp0"

title Gemini Gateway Launcher

if not exist "node_modules" (
  echo [INFO] Устанавливаю зависимости ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Ошибка установки зависимостей.
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
echo   [1] Локально  ^(Gateway :8081 + Web :3000^)
echo   [2] Онлайн    ^(Gateway :8081 + Web :3000 + ngrok^)
echo   [0] Выход
echo.
set /p choice="Выберите режим (1/2/0): "

if "%choice%"=="1" goto local
if "%choice%"=="2" goto online
if "%choice%"=="0" exit /b 0
goto menu

:local
echo.
echo [START] Запуск в локальном режиме...
echo Веб-панель: http://localhost:3000
echo API шлюза:  http://localhost:8081/v1
echo.
call npm run dev
pause
exit /b 0

:online
where ngrok >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] ngrok не найден в PATH.
  echo Установите его командой: winget install Ngrok.Ngrok
  echo После установки выполните: ngrok update ^&^& ngrok config add-authtoken ВАШ_ТОКЕН
  echo.
  pause
  goto menu
)

echo.
echo [START] Запускаю Gateway + Web в отдельном окне...
start "Gemini Gateway (npm run dev)" cmd /k "cd /d "%~dp0" && npm run dev"

timeout /t 2 /nobreak >nul

echo [START] Запускаю ngrok для порта 8081...
echo Веб-панель остаётся локально: http://localhost:3000
echo Публичный URL появится в окне ngrok ниже.
echo.
if defined NGROK_DOMAIN (
  start "ngrok Tunnel" cmd /k "ngrok http --domain=%NGROK_DOMAIN% 8081"
) else (
  start "ngrok Tunnel" cmd /k "ngrok http 8081"
)
exit /b 0
