#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Shared configuration. Sourced by every other script; not run directly.

set -euo pipefail

# ${BASH_SOURCE[0]} when sourced from bash, $0 when the script is run directly.
# ZPOC_REPO_DIR lets a non-bash caller point at the repo explicitly.
_self="${BASH_SOURCE[0]:-$0}"
REPO_DIR="${ZPOC_REPO_DIR:-$(cd "$(dirname "$_self")/.." && pwd)}"
LOCAL_DIR="$REPO_DIR/chains/local"

# --- The two chains -----------------------------------------------------------

# Local Besu. Ports deliberately avoid 8545/8745, which the ibc-dogfood
# besu-to-besu example uses and which may be live on this machine.
LOCAL_CHAIN_ID=41003
LOCAL_RPC="http://localhost:8945"
LOCAL_WS="ws://localhost:8946"

# Zenith testnet: the EVM execution layer of the Canton Network. Public, no auth.
ZENITH_CHAIN_ID=936485
ZENITH_RPC="https://rpc.testnet.zenith.network"
ZENITH_EXPLORER="https://explorer.testnet.zenith.network"
ZENITH_API="$ZENITH_EXPLORER/api"
# No public websocket exists. The relayer therefore auto-relays only from the
# Besu end; see README "Known limits".
ZENITH_WS=""

# --- IBC CLI ------------------------------------------------------------------

IBC_HOME="${IBC_HOME:-$HOME/.ibc-zpoc}"   # never ~/.ibc, which other work uses
IBC_BIN="$REPO_DIR/bin/ibc"
RELAYER_PORT=3100                          # not 3000

# Wrapper: pins --home and drops the sonic/ast build warning the binary prints
# on arm64, which is noise on every single invocation.
ibc() { "$IBC_BIN" --home "$IBC_HOME" "$@" 2>&1 | grep -v "^WARNING: sonic" || true; }

# addr <key-alias> — the EVM address behind a key in our keystore.
addr() { ibc keys show "$1" | jq -r '.evmAddress'; }

# rpc <url> <method> [params-json] — one JSON-RPC call, result only.
rpc() {
  local url="$1" method="$2" params="${3:-[]}"
  curl -s -m 30 -X POST -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$method\",\"params\":$params}" \
    "$url" | jq -r '.result // .error.message'
}

# balance <url> <address> — native balance in whole tokens.
balance() {
  local hex; hex=$(rpc "$1" eth_getBalance "[\"$2\",\"latest\"]")
  python3 -c "print(int('$hex',16)/1e18)"
}

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  !!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  xx\033[0m %s\n' "$*" >&2; exit 1; }
