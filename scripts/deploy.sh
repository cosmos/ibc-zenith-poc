#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Register both chains, deploy the IBC stack on each, and link the two IFT
# tokens. Idempotent: re-running skips chains already registered and reports
# what the deployment records already hold.

source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/env.sh"

A=$LOCAL_CHAIN_ID     # local Besu
B=$ZENITH_CHAIN_ID    # Zenith testnet

# --- 0. Preflight -------------------------------------------------------------
# Zenith gas is the one thing we cannot mint ourselves.

say "Preflight"
[[ "$(rpc "$LOCAL_RPC" eth_chainId)" == "0x$(printf %x "$A")" ]] \
  || die "local Besu not answering on $LOCAL_RPC — run: make up"
[[ "$(rpc "$ZENITH_RPC" eth_chainId)" == "0x$(printf %x "$B")" ]] \
  || die "Zenith not reachable at $ZENITH_RPC"

for k in deployer relayer; do
  bal=$(balance "$ZENITH_RPC" "$(addr "$k")")
  if (( $(python3 -c "print(1 if $bal < 1 else 0)") )); then
    die "$k has $bal ZTH on Zenith. Fund it: $ZENITH_EXPLORER/faucet  (or make fund)"
  fi
  ok "$k has $bal ZTH on Zenith"
done

# --- 1. Register the chains ---------------------------------------------------
# Zenith gets no --ws: it publishes no public websocket. That is what confines
# auto-relay to the Besu end; see README "Known limits".

registered() { ibc config show 2>/dev/null | jq -e --arg c "$1" '.chains[]? | select(.chainId==$c)' >/dev/null 2>&1; }

if ! grep -q "chainId: \"$A\"" "$IBC_HOME/ibc.yml" 2>/dev/null; then
  say "Registering chain $A (local Besu)"
  ibc config add-chain --chain-id "$A" --rpc "$LOCAL_RPC" --ws "$LOCAL_WS" --deployer deployer >/dev/null
fi
if ! grep -q "chainId: \"$B\"" "$IBC_HOME/ibc.yml" 2>/dev/null; then
  say "Registering chain $B (Zenith testnet)"
  ibc config add-chain --chain-id "$B" --rpc "$ZENITH_RPC" --deployer deployer >/dev/null
fi
ok "both chains registered"

# --- 2. Core ------------------------------------------------------------------
# Access manager, ICS26 router implementation, router behind a proxy, and the
# call that opens packet delivery to any caller.

for c in "$A" "$B"; do
  say "Deploying IBC core on $c"
  ibc deploy core --chain "$c" --yes | tail -5
done

# --- 3. Light clients ---------------------------------------------------------
# Crossed pairing: the client on A tracks B, so it trusts the attestor watching
# B. Threshold 1 of 1 — a demo trust set, not a production one.

say "Deploying attestation client on $A tracking $B"
ibc deploy client --chain "$A" --counterparty-chain "$B" --attestors "attestor-$B" --threshold 1 --yes | tail -4
say "Deploying attestation client on $B tracking $A"
ibc deploy client --chain "$B" --counterparty-chain "$A" --attestors "attestor-$A" --threshold 1 --yes | tail -4

# --- 4. Application -----------------------------------------------------------

for c in "$A" "$B"; do
  say "Deploying GMP on $c"
  ibc deploy gmp --chain "$c" --yes | tail -3
done

for c in "$A" "$B"; do
  say "Deploying IFT on $c"
  ibc deploy ift --name "Zenith PoC Token" --symbol ZPOC --chain "$c" --yes | tail -3
done

IFT_A=$(ibc deploy show "$A" | jq -r '.tokens[0].address')
IFT_B=$(ibc deploy show "$B" | jq -r '.tokens[0].address')
ok "IFT on $A: $IFT_A"
ok "IFT on $B: $IFT_B"

say "Linking the two tokens"
ibc deploy ift-bridge --chain-a "$A" --ift-a "$IFT_A" --chain-b "$B" --ift-b "$IFT_B" --yes | tail -4

CLIENT_ID="link-$A-$B"
ok "deployment complete — client id $CLIENT_ID"
