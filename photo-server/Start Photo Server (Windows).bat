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

:: Create logs directory early (needed for install logs)
if not exist "logs" mkdir logs

:: -----------------------------------------------------------
::  Pre-flight checks
:: -----------------------------------------------------------

:: Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   Node.js is not installed.
    echo.
    echo   The photo server requires Node.js to run.
    echo   Download and install it from: https://nodejs.org
    echo   ^(Use the LTS version — the big green button^)
    echo.
    echo   After installing Node.js, close this window and
    echo   double-click this bat file again.
    echo.
    goto :exit
)

:: Check for npm
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   npm is not available.
    echo.
    echo   npm is the package manager that comes with Node.js.
    echo   Reinstall Node.js from https://nodejs.org and make sure
    echo   "npm package manager" is checked during installation.
    echo.
    goto :exit
)

:: Check for PowerShell
where powershell >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   PowerShell is not available.
    echo.
    echo   The photo server needs PowerShell to safely read iCloud
    echo   Photos without triggering downloads of every file.
    echo   PowerShell comes pre-installed on Windows 10 and 11.
    echo.
    echo   If PowerShell has been removed or restricted on this
    echo   computer, it will need to be re-enabled before the
    echo   photo server can run.
    echo.
    goto :exit
)

for /f "tokens=*" %%i in ('node --version') do echo   Node.js %%i

:: -----------------------------------------------------------
::  Install dependencies (per-platform, avoids Dropbox conflicts)
:: -----------------------------------------------------------
::  Each platform installs into its own deps-{platform}/ folder
::  so macOS and Windows binaries coexist in the Dropbox share.

if not exist "deps-win32\node_modules\.package-ok" (
    echo.
    echo   Installing dependencies...
    echo   This may take a minute.
    echo.

    :: Create install directory
    if not exist "deps-win32" mkdir deps-win32

    :: Copy package.json (source of truth is in parent)
    copy /y package.json deps-win32\package.json >nul

    :: Move into install directory
    pushd deps-win32

    :: Step 1: Download packages
    echo   [1/3] Downloading packages...
    npm install --ignore-scripts --no-fund --no-audit >..\logs\npm-install.log 2>&1
    if %ERRORLEVEL% neq 0 (
        popd
        echo.
        echo   Package download failed.
        echo.
        echo   This usually means npm could not reach the package registry.
        echo   Check your internet connection, then close this window
        echo   and try again.
        echo.
        echo   If you are on a corporate network, a proxy or firewall
        echo   may be blocking npm. Ask IT for help.
        echo.
        echo   Full error log: logs\npm-install.log
        echo.
        goto :exit
    )

    :: Step 2: Build image processor
    echo   [2/3] Building image processor...
    npm rebuild sharp --no-fund --no-audit >..\logs\npm-rebuild-sharp.log 2>&1
    if %ERRORLEVEL% neq 0 (
        popd
        echo.
        echo   The image processor ^(sharp^) failed to build.
        echo.
        echo   Close this window and try again. If it keeps failing,
        echo   check whether antivirus software is blocking downloads
        echo   or your disk is full.
        echo.
        echo   Full error log: logs\npm-rebuild-sharp.log
        echo.
        goto :exit
    )

    :: Step 3: Verify everything works
    echo   [3/3] Verifying...

    :: Check module folders exist
    set "MODULES_OK=1"
    if not exist "node_modules\express" set "MODULES_OK=0"
    if not exist "node_modules\sharp" set "MODULES_OK=0"
    if not exist "node_modules\exifr" set "MODULES_OK=0"
    if not exist "node_modules\cors" set "MODULES_OK=0"

    if "%MODULES_OK%"=="0" (
        popd
        echo.
        echo   Some packages are missing after install.
        echo.
        echo   Delete the "deps-win32" folder next to this bat file,
        echo   then double-click this bat file to try again.
        echo.
        goto :exit
    )

    :: Smoke test: can sharp actually load?
    node -e "require('sharp')" >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        popd
        echo.
        echo   The image processor ^(sharp^) installed but cannot load.
        echo.
        echo   This usually means antivirus software quarantined a file,
        echo   or your Node.js version changed since dependencies were
        echo   installed.
        echo.
        echo   Fix: delete the "deps-win32" folder next to this bat file,
        echo   then double-click this bat file to try again. If your
        echo   antivirus flagged a file, add this folder to its
        echo   exclusion list.
        echo.
        goto :exit
    )

    :: All good — write success marker
    echo win32> node_modules\.package-ok
    popd

    echo   Dependencies installed successfully.
    echo.
)

echo   Dependencies ready
echo.
echo   Starting server...
echo   --------------------------
echo.

:: -----------------------------------------------------------
::  Launch server with NODE_PATH pointing to our platform deps
:: -----------------------------------------------------------
set "NODE_PATH=%~dp0deps-win32\node_modules"
node server-windows.js

:: If server exits, keep window open so user can see errors
echo.
echo   Server stopped. Press any key to close...
pause >nul
exit /b 0

:exit
echo   Press any key to close...
pause >nul
exit /b 1
