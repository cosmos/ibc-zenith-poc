#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Mint on Besu, send an IFT transfer over IBC to Zenith, wait for the packet to
# land, and print balances on both sides. Leaves Besu 90 / Zenith 10 on a fresh
# deploy. The return leg is scripts/return.sh (make return).
#
# Requires the relayer to be running (make relayer, or make demo).

source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/env.sh"

A=$LOCAL_CHAIN_ID
B=$ZENITH_CHAIN_ID
CLIENT_ID="link-$A-$B"
IFT_A=$(ibc deploy show "$A" | jq -r '.tokens[0].address')
IFT_B=$(ibc deploy show "$B" | jq -r '.tokens[0].address')
MINT=100000000000000000000   # 100 tokens, 18 decimals
SEND=10000000000000000000    #  10 tokens

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

# --- Mint ---------------------------------------------------------------------

say "Minting 100 ZPOC to deployer on Besu $A"
ibc tx ift mint --chain "$A" --ift "$IFT_A" --to deployer --from deployer --amount "$MINT" | tail -2
show_balances

# --- Besu -> Zenith -----------------------------------------------------------

say "Sending 10 ZPOC: Besu $A -> Zenith $B"
TX=$(ibc tx ift send --chain "$A" --ift "$IFT_A" --client-id "$CLIENT_ID" \
       --to deployer --from deployer --amount "$SEND" | jq -r '.txHash')
[[ "$TX" == 0x* ]] || die "send did not return a tx hash"
ok "send tx $TX"

say "Waiting for the packet"
STATE=$(wait_packet "$A" "$TX")
if [[ "$STATE" == "PACKET_STATE_SUCCEEDED" ]]; then
  ok "packet SUCCEEDED"
else
  warn "packet state: $STATE"
fi
ibc relayer packets --chain-id "$A" --tx-hash "$TX" | jq '.packets[0]'
show_balances

echo
say "Explorer: $ZENITH_EXPLORER/tx/$TX"
