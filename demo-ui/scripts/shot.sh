#!/usr/bin/env bash
# shot.sh <query> <out.png> — screenshot the UI at 1920x1080 with headless Chrome.
# Needs a running server: `npm run dev` (port 5173) or `npm run live` (BASE=http://localhost:3200).
set -euo pipefail
BASE="${BASE:-http://localhost:5173}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1920,1080 \
  --virtual-time-budget=4000 --screenshot="$2" "$BASE/?$1" 2>/dev/null
echo "$2"
