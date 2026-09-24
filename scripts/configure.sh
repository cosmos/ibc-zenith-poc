#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Render the relayer sections from the deployment records, disable auto-relay on
# the Zenith end, merge into the config, and validate against both live chains.

source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/env.sh"

A=$LOCAL_CHAIN_ID
B=$ZENITH_CHAIN_ID
CFG="$IBC_HOME/ibc.yml"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

say "Rendering relayer config from deployment records"
ibc deploy render-config "$A" "$B" --signer-a relayer --signer-b relayer > "$TMP/rendered.yml"
grep -q "^chains:" "$TMP/rendered.yml" || die "render-config produced nothing usable"

# Zenith publishes no websocket, and the relayer subscribes over one to source
# auto-relayed packets. Leaving autoRelay on for clientB makes `config validate`
# fail outright. Turning it off is what makes the Zenith -> Besu leg manual;
# see README "Known limits".
say "Disabling auto-relay on the Zenith end (no public websocket)"
perl -0pi -e 's/(clientB:.*?autoRelay:\s*\n\s*enabled:\s*)true/${1}false/s' "$TMP/rendered.yml"

grep -A1 'clientB:' "$TMP/rendered.yml" >/dev/null
if perl -0ne 'exit(/clientB:.*?enabled:\s*false/s ? 0 : 1)' "$TMP/rendered.yml"; then
  ok "clientB autoRelay disabled"
else
  die "could not disable autoRelay on clientB — inspect $TMP/rendered.yml"
fi

# Keep our own server, db and signers blocks; replace the three generated ones.
say "Merging into $CFG"
{
  sed -n '1,/^chains:/p' "$CFG" | sed '$d'
  cat "$TMP/rendered.yml"
  sed -n '/^signers:/,$p' "$CFG"
} > "$TMP/merged.yml"
mv "$TMP/merged.yml" "$CFG"

say "Validating against both live chains"
ibc config validate --live --strict
