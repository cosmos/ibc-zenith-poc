#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Top up the deployer and relayer with ZTH on Zenith testnet.
#
# The faucet has a plain POST endpoint with no captcha, so this is scriptable:
#   POST /api/faucet {"address":"0x…"} -> 100 ZTH, one claim per address / 30 min.
# Already-funded accounts are skipped rather than burning a cooldown.

source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/env.sh"

MIN_ZTH=1   # a full deploy costs well under this at a 7 wei base fee

for k in deployer relayer; do
  a=$(addr "$k")
  bal=$(balance "$ZENITH_RPC" "$a")
  if (( $(python3 -c "print(1 if $bal >= $MIN_ZTH else 0)") )); then
    ok "$k already has $bal ZTH — skipping"
    continue
  fi
  say "Requesting ZTH for $k ($a)"
  resp=$(curl -s -m 30 -X POST "$ZENITH_API/faucet" \
           -H 'Content-Type: application/json' -d "{\"address\":\"$a\"}")
  if echo "$resp" | jq -e '.ok == true' >/dev/null 2>&1; then
    ok "sent $(echo "$resp" | jq -r '.zthAmount') ZTH, tx $(echo "$resp" | jq -r '.zthTxHash')"
  else
    warn "faucet declined: $resp"
    warn "claim manually at $ZENITH_EXPLORER/faucet for $a"
  fi
done

say "Balances on Zenith"
for k in deployer relayer; do
  printf '     %-9s %s = %s ZTH\n' "$k" "$(addr "$k")" "$(balance "$ZENITH_RPC" "$(addr "$k")")"
done
