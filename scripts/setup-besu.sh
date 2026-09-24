#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Bring up the local Besu chain: generate keys if absent, render the genesis
# around our funded accounts, start the container, wait for RPC.
#
# Safe to re-run. Touches only container besu-zpoc and chains/local/.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

# --- 1. IBC keys --------------------------------------------------------------
# Four keys: deployer and relayer pay gas on both chains; one attestor per chain
# signs packet state and never needs funding.

if [[ ! -f "$IBC_HOME/ibc.yml" ]]; then
  say "Creating IBC config at $IBC_HOME"
  ibc config new >/dev/null
fi

for k in deployer relayer "attestor-$LOCAL_CHAIN_ID" "attestor-$ZENITH_CHAIN_ID"; do
  if ! ibc keys list | jq -e --arg n "$k" '.[] | select(.name==$n)' >/dev/null 2>&1; then
    say "Generating key $k"
    ibc keys new ecdsa "$k" --populate-config >/dev/null
  fi
done

DEPLOYER=$(addr deployer)
RELAYER=$(addr relayer)
ok "deployer $DEPLOYER"
ok "relayer  $RELAYER"

# --- 2. Validator key ---------------------------------------------------------
# Besu's QBFT signing key. Generated once and kept in chains/local/, which is
# gitignored. Demo key: it signs every block on a local devnet and nothing else.

mkdir -p "$LOCAL_DIR"
if [[ ! -f "$LOCAL_DIR/key" ]]; then
  say "Generating Besu validator key"
  cast wallet new --json | jq -r '.[0].private_key' | sed 's/^0x//' > "$LOCAL_DIR/key"
  chmod 600 "$LOCAL_DIR/key"
fi
VALIDATOR=$(cast wallet address --private-key "0x$(cat "$LOCAL_DIR/key")")
ok "validator $VALIDATOR"

# --- 3. Genesis ---------------------------------------------------------------
# QBFT extraData is RLP: 32 zero bytes of vanity, a one-entry validator list,
# empty votes, round 0, empty committed seals.

qbft_extradata() {
  local a; a=$(printf '%s' "${1#0x}" | tr 'A-F' 'a-f')
  [[ ${#a} -eq 40 ]] || die "bad validator address: $1"
  printf '0xf83aa0%064dd594%sc080c0' 0 "$a"
}

# 1,000,000 ETH each to deployer, relayer, and the validator.
BAL='0xd3c21bcecceda1000000'
GENESIS_ALLOC=$(printf '    "%s": { "balance": "%s" },\n' \
  "$DEPLOYER" "$BAL" "$RELAYER" "$BAL" "$VALIDATOR" "$BAL")

export CHAIN_ID="$LOCAL_CHAIN_ID"
export QBFT_EXTRADATA; QBFT_EXTRADATA=$(qbft_extradata "$VALIDATOR")
export GENESIS_ALLOC

render() { perl -pe 's/\$\{(\w+)\}/defined $ENV{$1} ? $ENV{$1} : ""/ge' "$1" > "$2"; }
render "$REPO_DIR/chains/besu.toml.tmpl"   "$LOCAL_DIR/besu.toml"
render "$REPO_DIR/chains/genesis.json.tmpl" "$LOCAL_DIR/genesis.json"
jq empty "$LOCAL_DIR/genesis.json" || die "rendered genesis is not valid JSON"
ok "rendered genesis for chain $LOCAL_CHAIN_ID"

# --- 4. Start -----------------------------------------------------------------

say "Starting besu-zpoc (ports 8945/8946/9945)"
docker compose -f "$REPO_DIR/docker-compose.yml" up -d

say "Waiting for RPC at $LOCAL_RPC"
for i in $(seq 1 60); do
  got=$(rpc "$LOCAL_RPC" eth_chainId 2>/dev/null || true)
  if [[ "$got" == "0x"* ]]; then
    dec=$((got))
    [[ "$dec" == "$LOCAL_CHAIN_ID" ]] || die "chain id is $dec, expected $LOCAL_CHAIN_ID"
    ok "chain $dec live, block $(( $(rpc "$LOCAL_RPC" eth_blockNumber) ))"
    exit 0
  fi
  sleep 2
done
die "Besu did not answer RPC in 120s — try: docker logs besu-zpoc"
