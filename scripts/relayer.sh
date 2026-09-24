#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Start or stop the relayer. Runs in dual mode: the attestors live in the same
# process, because render-config declared them type: local.
#
# usage: relayer.sh start | stop | status

source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/env.sh"

PIDFILE="$REPO_DIR/logs/relayer.pid"
LOGFILE="$REPO_DIR/logs/relayer.log"
mkdir -p "$REPO_DIR/logs"

running() { [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

case "${1:-start}" in
  start)
    if running; then ok "relayer already running (pid $(cat "$PIDFILE"))"; exit 0; fi
    say "Starting relayer on port $RELAYER_PORT"
    nohup "$IBC_BIN" --home "$IBC_HOME" relayer run > "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    for i in $(seq 1 30); do
      if grep -q "readiness=" "$LOGFILE" 2>/dev/null; then
        ok "$(grep -o 'ChainsConnected:\[[^]]*\]' "$LOGFILE" | tail -1)"
        # Only the Besu end is subscribed: Zenith publishes no websocket.
        grep -o 'Subscribed to send packets.*' "$LOGFILE" | sed 's/^/     /'
        exit 0
      fi
      sleep 2
    done
    die "relayer did not report readiness in 60s — see $LOGFILE"
    ;;
  stop)
    if running; then
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      rm -f "$PIDFILE"
      ok "relayer stopped"
    else
      ok "relayer not running"
    fi
    ;;
  status)
    running && ok "relayer running (pid $(cat "$PIDFILE"))" || warn "relayer not running"
    ;;
  *) die "usage: relayer.sh start|stop|status" ;;
esac
