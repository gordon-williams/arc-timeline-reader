@echo off
:: ============================================================
::  Arc Photo Server (Windows) - Double-click to start
:: ============================================================
::  This serves your iCloud Photos to Arc Diary Reader.
::  Keep this window open while browsing photos in the diary.
::  Press Ctrl+C or close the window to stop.
:: ============================================================

title Arc Photo Server (Windows)

cd /d "%~dp0"

echo.
echo   Arc Photo Server (Windows)
echo   --------------------------
echo.

:: Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Node.js is not installed.
    echo.
    echo   Install it from: https://nodejs.org
    echo.
    echo   Press any key to close...
    pause >nul
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do echo   Node.js %%i

:: Install dependencies if needed
if not exist "node_modules" (
    echo   Installing dependencies (first run only^)...
    npm install --no-fund --no-audit
    echo.
)

echo   Dependencies ready
echo.
echo   Starting server...
echo   --------------------------
echo.

:: Create logs directory
if not exist "logs" mkdir logs

:: Start the server
node server-windows.js

:: If server exits, keep window open so user can see errors
echo.
echo   Server stopped. Press any key to close...
pause >nul
