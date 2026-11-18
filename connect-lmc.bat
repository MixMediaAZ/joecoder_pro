@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules" (
    call npm ci --ignore-scripts --no-audit --no-fund
    if errorlevel 1 exit /b 1
)
call npm run lmc:sync -- %*
set "RESULT=%errorlevel%"
if not "%RESULT%"=="0" echo [ERROR] LMC connection failed. See the message above and README_RUN.md.
pause
exit /b %RESULT%
