#!/bin/bash
# ============================================================
#  Arc Photo Server (macOS) — Double-click to start
# ============================================================
#  This serves your Apple Photos library to Arc Diary Reader.
#  Keep this window open while browsing photos in the diary.
#  Press Ctrl+C or close the window to stop.
# ============================================================

cd "$(dirname "$0")"

echo ""
echo "  Arc Photo Server"
echo "  ---------------------"
echo ""

# Create logs directory early (needed for install logs)
mkdir -p logs

# -----------------------------------------------------------
#  Pre-flight checks
# -----------------------------------------------------------

# Check for Node.js
if ! command -v node &>/dev/null; then
    echo "  Node.js is not installed."
    echo ""
    echo "  The photo server requires Node.js to run."
    echo "  Install it from: https://nodejs.org (use the LTS version)"
    echo "  Or with Homebrew: brew install node"
    echo ""
    echo "  After installing Node.js, close this window and"
    echo "  double-click \"Start Photo Server.command\" again."
    echo ""
    echo "  Press any key to close..."
    read -n 1
    exit 1
fi

# Check for npm
if ! command -v npm &>/dev/null; then
    echo "  npm is not available."
    echo ""
    echo "  npm is the package manager that comes with Node.js."
    echo "  Reinstall Node.js from https://nodejs.org, or with"
    echo "  Homebrew: brew install node"
    echo ""
    echo "  Press any key to close..."
    read -n 1
    exit 1
fi

echo "  Node.js $(node --version)"

# -----------------------------------------------------------
#  Install dependencies (per-platform, avoids Dropbox conflicts)
# -----------------------------------------------------------
#  Each platform installs into its own deps-{platform}/ folder
#  so macOS and Windows binaries coexist in the Dropbox share.

if [ ! -f "deps-darwin/node_modules/.package-ok" ]; then
    echo ""
    echo "  Installing dependencies..."
    echo "  This may take a minute."
    echo ""

    # Create install directory
    mkdir -p deps-darwin

    # Copy package.json (source of truth is in parent)
    cp -f package.json deps-darwin/package.json

    # Move into install directory
    cd deps-darwin

    # Step 1: Download and build packages
    echo "  [1/2] Downloading and building packages..."
    if ! npm install --no-fund --no-audit >../logs/npm-install.log 2>&1; then
        cd ..
        echo ""
        echo "  Package installation failed."
        echo ""
        echo "  This usually means npm could not reach the package registry,"
        echo "  or a native module failed to compile."
        echo ""
        echo "  Check your internet connection, then close this window"
        echo "  and try again."
        echo ""
        echo "  If a compile error mentions Xcode, install the command"
        echo "  line tools by running:  xcode-select --install"
        echo ""
        echo "  Full error log: logs/npm-install.log"
        echo ""
        echo "  Press any key to close..."
        read -n 1
        exit 1
    fi

    # Step 2: Verify everything works
    echo "  [2/2] Verifying..."

    # Check module folders exist
    MISSING=""
    [ ! -d "node_modules/express" ] && MISSING="$MISSING express"
    [ ! -d "node_modules/sharp" ] && MISSING="$MISSING sharp"
    [ ! -d "node_modules/exifr" ] && MISSING="$MISSING exifr"
    [ ! -d "node_modules/cors" ] && MISSING="$MISSING cors"
    [ ! -d "node_modules/better-sqlite3" ] && MISSING="$MISSING better-sqlite3"

    if [ -n "$MISSING" ]; then
        cd ..
        echo ""
        echo "  Missing packages after install:$MISSING"
        echo ""
        echo "  Delete the \"deps-darwin\" folder next to this script,"
        echo "  then double-click this script to try again."
        echo ""
        echo "  If better-sqlite3 failed to compile, you may need"
        echo "  Xcode Command Line Tools:  xcode-select --install"
        echo ""
        echo "  Press any key to close..."
        read -n 1
        exit 1
    fi

    # Smoke test: can the native modules actually load?
    if ! node -e "require('sharp'); require('better-sqlite3')" 2>/dev/null; then
        cd ..
        echo ""
        echo "  Native modules installed but cannot load."
        echo ""
        echo "  This usually means your Node.js version changed since"
        echo "  dependencies were installed, or Xcode tools need updating."
        echo ""
        echo "  Fix: delete the \"deps-darwin\" folder next to this script,"
        echo "  then double-click this script to try again."
        echo ""
        echo "  To update Xcode tools:  xcode-select --install"
        echo ""
        echo "  Press any key to close..."
        read -n 1
        exit 1
    fi

    # All good — write success marker
    echo "darwin" > node_modules/.package-ok
    cd ..

    echo "  Dependencies installed successfully."
    echo ""
fi

echo "  Dependencies ready"
echo ""
echo "  Starting server..."
echo "  ---------------------"
echo ""

# Persist server output for crash diagnosis
LOG_FILE="logs/photo-server-$(date +%Y%m%d-%H%M%S).log"
echo "  Logging to: $LOG_FILE"
echo ""

# Launch server with NODE_PATH pointing to our platform deps
export NODE_PATH="$(pwd)/deps-darwin/node_modules"
node server.js 2>&1 | tee "$LOG_FILE"

# If server exits, keep window open so user can see errors
echo ""
echo "  Server stopped. Press any key to close..."
read -n 1
