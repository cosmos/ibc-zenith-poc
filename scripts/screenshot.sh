#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Regenerate docs/img/canton-linkage.png: the Zenith explorer page for our
# packet-delivery transaction, showing its originating Canton transaction.
#
# Runs headless Chrome against a throwaway profile so it never touches the
# user's own browser session.
#
# usage: screenshot.sh [tx-hash]   (defaults to the run recorded in RESULTS.md)

source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/env.sh"

TX="${1:-0xeb0417e13abbfe9549d6de3ed9ceb4caf0432e2666cdbb1bf36d9853a397124c}"
OUT="$REPO_DIR/docs/img/canton-linkage.png"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[[ -x "$CHROME" ]] || die "Chrome not found at $CHROME — install it or capture the page by hand"

mkdir -p "$(dirname "$OUT")"
PROFILE=$(mktemp -d)
CHROME_PID=""
cleanup() {
  [[ -n "$CHROME_PID" ]] && kill "$CHROME_PID" 2>/dev/null
  rm -rf "$PROFILE"
}
trap cleanup EXIT

rm -f "$OUT"

# `--headless=new --screenshot` writes the file but does not reliably exit: on
# this page Chrome sits there until killed, which hangs `make screenshot`
# forever. So run it in the background, wait for the artifact, and kill it.
say "Capturing $ZENITH_EXPLORER/tx/${TX:0:12}…"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="$PROFILE" \
  --window-size=1280,1400 \
  --virtual-time-budget=15000 \
  --screenshot="$OUT" \
  "$ZENITH_EXPLORER/tx/$TX" >/dev/null 2>&1 &
CHROME_PID=$!

# Wait for the file to appear and stop growing, then stop waiting regardless.
last=0
for i in $(seq 1 45); do
  sleep 2
  if [[ -s "$OUT" ]]; then
    now=$(wc -c < "$OUT")
    [[ "$now" == "$last" ]] && break
    last=$now
  fi
  kill -0 "$CHROME_PID" 2>/dev/null || break
done

kill "$CHROME_PID" 2>/dev/null
CHROME_PID=""

# Judge by the artifact: Chrome's exit status is not meaningful here.
if [[ -s "$OUT" ]]; then
  ok "wrote $OUT ($(( $(wc -c < "$OUT") / 1024 )) KB)"
else
  die "no screenshot produced — check that the explorer is reachable"
fi
