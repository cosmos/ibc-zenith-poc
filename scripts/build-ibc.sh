#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Build bin/ibc from github.com/cosmos/ibc at the commit this PoC was verified
# against. Skips the build when bin/ibc already exists at that commit, so it is
# cheap to run on every `make up`. First build: about a minute plus downloads.

ZPOC_NO_IBC_CHECK=1 source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/env.sh"

SRC="$REPO_DIR/.cache/cosmos-ibc"

built_at() { go version -m "$IBC_BIN" 2>/dev/null | awk '$2 ~ /^vcs.revision=/ { sub("vcs.revision=", "", $2); print $2 }'; }

if [[ -x "$IBC_BIN" && "$(built_at)" == "$IBC_COMMIT" ]]; then
  ok "ibc CLI present (cosmos/ibc ${IBC_COMMIT:0:8})"
  exit 0
fi

# go.mod asks for Go 1.26.4. An older Go (1.21+) fetches that toolchain by
# itself when GOTOOLCHAIN allows it, so force that rather than fail.
export GOTOOLCHAIN=auto

say "Building the ibc CLI from $IBC_SRC_REPO at ${IBC_COMMIT:0:8}"
if [[ ! -d "$SRC/.git" ]]; then
  mkdir -p "$(dirname "$SRC")"
  git clone --quiet --filter=blob:none "$IBC_SRC_REPO" "$SRC" \
    || die "could not clone $IBC_SRC_REPO — check your network"
fi
git -C "$SRC" cat-file -e "$IBC_COMMIT^{commit}" 2>/dev/null || git -C "$SRC" fetch --quiet origin \
  || die "could not fetch $IBC_SRC_REPO"
git -C "$SRC" checkout --quiet --detach "$IBC_COMMIT" \
  || die "commit $IBC_COMMIT not found in $IBC_SRC_REPO"

mkdir -p "$(dirname "$IBC_BIN")"
say "Compiling (first build downloads Go modules; about a minute)"
( cd "$SRC/link" && go build -o "$IBC_BIN.tmp" ./cmd/ibc ) \
  || { rm -f "$IBC_BIN.tmp"; die "go build failed — see the output above"; }
mv "$IBC_BIN.tmp" "$IBC_BIN"
ok "built $IBC_BIN"
