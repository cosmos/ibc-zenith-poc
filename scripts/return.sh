#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# The return leg: send 10 ZPOC Zenith -> Besu over IBC and wait for it.
#
# Requires the relayer to be running (make relayer, or make demo).

source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/env.sh"

A=$LOCAL_CHAIN_ID
B=$ZENITH_CHAIN_ID
CLIENT_ID="link-$A-$B"
IFT_A=$(ibc deploy show "$A" | jq -r '.tokens[0].address')
IFT_B=$(ibc deploy show "$B" | jq -r '.tokens[0].address')
SEND=10000000000000000000    # 10 tokens, 18 decimals

curl -s -m 5 "http://localhost:$RELAYER_PORT/health" >/dev/null 2>&1 \
  || warn "relayer health endpoint not answering on $RELAYER_PORT — is it running?"

bal() { ibc query ift balance --chain "$1" --ift "$2" --address deployer | jq -r '.balance'; }
show_balances() {
  printf '     Besu %s: %s ZPOC\n' "$A" "$(python3 -c "print(int('$(bal "$A" "$IFT_A")')/1e18)")"
  printf '     Zenith %s: %s ZPOC\n' "$B" "$(python3 -c "print(int('$(bal "$B" "$IFT_B")')/1e18)")"
}

# wait_packet <chain> <txhash> — poll until the packet leaves PENDING.
wait_packet() {
  local chain="$1" tx="$2" state=""
  for i in $(seq 1 40); do
    state=$(ibc relayer packets --chain-id "$chain" --tx-hash "$tx" | jq -r '.packets[0].state // "UNKNOWN"')
    [[ "$state" == "PACKET_STATE_PENDING" || "$state" == "UNKNOWN" ]] || { echo "$state"; return 0; }
    sleep 5
  done
  echo "$state"
}

# --- Zenith -> Besu -----------------------------------------------------------
# Auto-relay is off on the Zenith end because Zenith publishes no websocket, so
# no watcher fires on this send. The websocket only drives automatic discovery,
# though — `relayer relay` names the source transaction explicitly and the same
# pipeline carries the packet. One extra command, and the round trip completes.
#
# Trigger it promptly: the packet's timeout defaults to 15 minutes from the
# send, and a relay after that window carries a timeout-and-refund instead of a
# delivery (which also works, and returns the tokens on the source chain).

say "Return leg: Zenith $B -> Besu $A"
TX_R=$(ibc tx ift send --chain "$B" --ift "$IFT_B" --client-id "$CLIENT_ID" \
        --to deployer --from deployer --amount "$SEND" | jq -r '.txHash' 2>/dev/null || true)
if [[ "$TX_R" == 0x* ]]; then
  ok "return send tx $TX_R"
  sleep 8   # let the send land before asking the relayer to read it
  say "Triggering the relay by hand (no websocket on the Zenith end)"
  ibc relayer relay --chain-id "$B" --tx-hash "$TX_R" | head -12
  STATE_R=$(wait_packet "$B" "$TX_R")
  if [[ "$STATE_R" == "PACKET_STATE_SUCCEEDED" ]]; then
    ok "return packet SUCCEEDED — full round trip"
  else
    warn "return packet state: $STATE_R"
  fi
  ibc relayer packets --chain-id "$B" --tx-hash "$TX_R" | jq '.packets[0]'
  show_balances
else
  warn "return send did not produce a tx hash"
fi

echo
say "Explorer: $ZENITH_EXPLORER/tx/$TX_R"
