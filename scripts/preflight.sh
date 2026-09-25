#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Check the tools `make up` needs before doing anything, and say exactly what
# is missing. Everything else in the PoC assumes these are present.

ZPOC_NO_IBC_CHECK=1 source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/env.sh"

missing=0
need() {  # need <command> <how to get it>
  if command -v "$1" >/dev/null 2>&1; then return 0; fi
  warn "$1 not found — $2"
  missing=1
}

say "Checking prerequisites"
need docker  "install Docker Desktop: https://docs.docker.com/get-docker/"
need go      "install Go 1.26+: https://go.dev/dl/"
need git     "install git"
need jq      "brew install jq"
need perl    "install perl"
need python3 "install Python 3"
need curl    "install curl"
need cast    "install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"

if command -v docker >/dev/null 2>&1; then
  docker compose version >/dev/null 2>&1 || { warn "docker compose plugin not found — update Docker Desktop"; missing=1; }
  docker info >/dev/null 2>&1 || { warn "Docker is installed but not running — start Docker Desktop"; missing=1; }
fi

(( missing == 0 )) || die "install the above, then run make up again"
ok "all prerequisites present"
