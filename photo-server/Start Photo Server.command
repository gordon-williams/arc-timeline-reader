#!/bin/bash
# ============================================================
#  Arc Photo Server — Double-click to start
# ============================================================
#  This serves your Apple Photos library to Arc Diary Reader.
#  Keep this window open while browsing photos in the diary.
#  Press Ctrl+C or close the window to stop.
# ============================================================

cd "$(dirname "$0")"

echo ""
echo "  📷  Arc Photo Server"
echo "  ─────────────────────"
echo ""

# Check for Node.js
if ! command -v node &>/dev/null; then
    echo "  ❌  Node.js is not installed."
    echo ""
    echo "  Install it from: https://nodejs.org"
    echo "  Or with Homebrew: brew install node"
    echo ""
    echo "  Press any key to close..."
    read -n 1
    exit 1
fi

echo "  ✓  Node.js $(node --version)"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "  ⏳  Installing dependencies (first run only)..."
    npm install --no-fund --no-audit 2>&1 | sed 's/^/     /'
    echo ""
fi

echo "  ✓  Dependencies ready"
echo ""
echo "  Starting server..."
echo "  ─────────────────────"
echo ""

# Start the server
node server.js

# If server exits, keep window open so user can see errors
echo ""
echo "  Server stopped. Press any key to close..."
read -n 1
