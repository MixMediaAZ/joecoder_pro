@echo off
setlocal enabledelayedexpansion
set "NO_PAUSE="
if /i "%~1"=="--no-pause" set "NO_PAUSE=1"

:: Change to the directory where this .bat file lives
cd /d "%~dp0"

echo ================================================
echo   JoeCoder Pro 20.1
echo   Node 22.23.1 (Volta) - Pure JS - Zero native
echo ================================================
echo.

:: Require the runtime version this build is tested against.
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found in PATH.
    echo Please make sure Volta is active or Node 22+ is installed.
    if not defined NO_PAUSE pause
    exit /b 1
)

echo [Node]
node -v
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 22 (
    echo [ERROR] JoeCoder requires Node 22 or newer.
    if not defined NO_PAUSE pause
    exit /b 1
)
echo.

if not exist ".jc" mkdir ".jc"

:: Detect a healthy existing instance before building or opening shared state.
node tools\check-running.mjs --open
set RUNNING_CHECK=%errorlevel%
if %RUNNING_CHECK% equ 20 (
    echo.
    echo [SUCCESS] JoeCoder is ready in the existing browser session.
    ping 127.0.0.1 -n 3 >nul
    exit /b 0
)
if %RUNNING_CHECK% equ 21 (
    echo.
    echo [ERROR] The existing JoeCoder process cannot create a fresh session.
    echo [INFO] Close the older JoeCoder process, then run start.bat again.
    if not defined NO_PAUSE pause
    exit /b 1
)
if not %RUNNING_CHECK% equ 0 (
    echo [ERROR] Could not verify whether JoeCoder is already running.
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm ci --ignore-scripts --no-audit --no-fund --prefer-offline
    if errorlevel 1 (
        echo [ERROR] Exact lockfile dependency install failed.
        if not defined NO_PAUSE pause
        exit /b 1
    )
)

echo [INFO] Building current source...
if exist "frontend\package.json" (
    if not exist "frontend\node_modules" (
        call npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
        if errorlevel 1 exit /b 1
    )
    call npm --prefix frontend run build
    if errorlevel 1 exit /b 1
)
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed. JoeCoder will not start stale output.
    if not defined NO_PAUSE pause
    exit /b 1
)

echo.
echo [SUCCESS] Starting the current verified build...
echo Server listening on http://127.0.0.1 (dynamic port)
echo Press Ctrl+C to stop the server.
echo.

:: Default to a small local coding model unless the operator already pinned one.
if not defined JC_OLLAMA_MODEL set "JC_OLLAMA_MODEL=qwen2.5-coder:14b"
echo [INFO] Local model: %JC_OLLAMA_MODEL%
:: Optional PowerRouter gateway (mint key in PowerRouter: node scripts/keys.js add joecoder)
:: set "JC_POWERROUTER_URL=http://127.0.0.1:7474"
:: set "JC_POWERROUTER_KEY=sk-pr-PASTE_KEY_HERE"
:: set "JC_POWERROUTER_PROJECT=joecoder-pro-20.1"
echo.

set RESTART_COUNT=0
:serve
node dist/index.js
set EXITCODE=%errorlevel%
if %EXITCODE% equ 0 goto done
set /a RESTART_COUNT+=1

echo.
echo [WARN] Server exited unexpectedly (code %EXITCODE%) at %date% %time%. Attempt !RESTART_COUNT! of 3.
echo %date% %time% exit code %EXITCODE% >> ".jc\server-crashes.log"
if !RESTART_COUNT! GEQ 3 goto restart_failed
echo [INFO] Restarting in 3 seconds... (Ctrl+C to stop)
timeout /t 3 /nobreak >nul
goto serve

:restart_failed
echo.
echo [ERROR] JoeCoder stopped after 3 consecutive failed starts.
echo [INFO] Review .jc\server-crashes.log and the errors above before retrying.
if not defined NO_PAUSE pause
exit /b %EXITCODE%

:done
echo.
if defined NO_PAUSE exit /b 0
echo [INFO] Server stopped cleanly. Press any key to close this window.
pause >nul
