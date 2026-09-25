# SPDX-License-Identifier: Apache-2.0
#
# Besu <-> Zenith IBC PoC. Three commands:
#   make up     local Besu + ZTH for gas on Zenith
#   make demo   deploy IBC on both chains, run the relayer, move a token
#   make down   stop and remove our container only

SHELL := /bin/bash
S     := scripts

.PHONY: help up fund demo deploy configure relayer transfer return status logs screenshot ui ui-live down clean

help:
	@echo "make up      check prerequisites, build the ibc CLI, start local Besu, fund Zenith"
	@echo "make demo    deploy IBC on both chains, start the relayer, transfer a token"
	@echo "make down    stop the local chain and the relayer"
	@echo ""
	@echo "make return  send 10 ZPOC back, Zenith -> Besu"
	@echo "make status  what is running, balances on both chains"
	@echo "make logs    tail the relayer log"
	@echo "make clean   down, plus delete chain data and the IBC home"
	@echo ""
	@echo "make ui      packet-journey demo UI, scripted (http://localhost:5173)"
	@echo "make ui-live demo UI driving the real PoC (http://localhost:3200/?live)"

up:
	@bash $(S)/preflight.sh
	@bash $(S)/build-ibc.sh
	@bash $(S)/setup-besu.sh
	@bash $(S)/fund.sh

# Build bin/ibc from cosmos/ibc at the pinned commit (make up does this too).
ibc:
	@bash $(S)/build-ibc.sh

fund:
	@bash $(S)/fund.sh

# Idempotent end to end: re-running after a failure picks up where it stopped.
demo: deploy configure relayer transfer

deploy:
	@bash $(S)/deploy.sh

configure:
	@bash $(S)/configure.sh

relayer:
	@bash $(S)/relayer.sh start

transfer:
	@bash $(S)/transfer.sh

# The return leg, Zenith -> Besu. Kept out of `make demo` so a fresh deploy
# leaves round balances (Besu 90 / Zenith 10).
return:
	@bash $(S)/return.sh

status:
	@bash $(S)/status.sh

logs:
	@tail -f logs/relayer.log

# Re-capture the Canton linkage image used in the README.
screenshot:
	@bash $(S)/screenshot.sh

# Packet-journey UI for the video. Scripted needs nothing running; live needs
# `make up && make demo` to have succeeded.
NODE_CHECK = command -v npm >/dev/null 2>&1 && node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' \
  || { echo "The demo UI needs Node 20+ and npm: https://nodejs.org"; exit 1; }

ui:
	@$(NODE_CHECK)
	@cd demo-ui && npm install --silent && npm run dev

ui-live:
	@$(NODE_CHECK)
	@cd demo-ui && npm install --silent && npm run build && npm run live

down:
	@bash $(S)/relayer.sh stop
	@docker compose down --remove-orphans

# Full reset. Deletes the local chain's data and this PoC's IBC home
# (~/.ibc-zpoc) — never ~/.ibc, which other work on this machine uses.
clean: down
	@docker compose down -v --remove-orphans
	@rm -rf chains/local logs
	@rm -rf $${IBC_HOME:-$$HOME/.ibc-zpoc}
	@echo "clean: chain data, logs and ~/.ibc-zpoc removed"
