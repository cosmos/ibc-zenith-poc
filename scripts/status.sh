#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# What is running, and where the tokens are.

source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/env.sh"

A=$LOCAL_CHAIN_ID
B=$ZENITH_CHAIN_ID

say "Chains"
lb=$(rpc "$LOCAL_RPC" eth_blockNumber 2>/dev/null || echo "")
if [[ "$lb" == 0x* ]]; then ok "Besu $A   $LOCAL_RPC  block $((lb))"; else warn "Besu $A not answering at $LOCAL_RPC"; fi
zb=$(rpc "$ZENITH_RPC" eth_blockNumber 2>/dev/null || echo "")
if [[ "$zb" == 0x* ]]; then ok "Zenith $B  $ZENITH_RPC  block $((zb))"; else warn "Zenith not reachable"; fi

say "Relayer"
bash "$REPO_DIR/scripts/relayer.sh" status

say "Gas"
for k in deployer relayer; do
  printf '     %-9s Besu %s / Zenith %s ZTH\n' "$k" \
    "$(balance "$LOCAL_RPC" "$(addr "$k")" 2>/dev/null || echo '-')" \
    "$(balance "$ZENITH_RPC" "$(addr "$k")" 2>/dev/null || echo '-')"
done

if ibc deploy show "$A" >/dev/null 2>&1; then
  IFT_A=$(ibc deploy show "$A" | jq -r '.tokens[0].address // empty')
  IFT_B=$(ibc deploy show "$B" | jq -r '.tokens[0].address // empty')
  if [[ -n "$IFT_A" && -n "$IFT_B" ]]; then
    say "ZPOC balances"
    for pair in "$A:$IFT_A:Besu" "$B:$IFT_B:Zenith"; do
      c=${pair%%:*}; rest=${pair#*:}; ift=${rest%%:*}; label=${rest#*:}
      raw=$(ibc query ift balance --chain "$c" --ift "$ift" --address deployer 2>/dev/null | jq -r '.balance // "0"')
      printf '     %-7s %s  %s ZPOC\n' "$label" "$ift" "$(python3 -c "print(int('$raw')/1e18)")"
    done
  fi
fi
