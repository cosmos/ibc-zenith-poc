# SPDX-License-Identifier: Apache-2.0
#
# Besu <-> Zenith IBC PoC. Three commands:
#   make up     local Besu + ZTH for gas on Zenith
#   make demo   deploy IBC on both chains, run the relayer, move a token
#   make down   stop and remove our container only

SHELL := /bin/bash
S     := scripts

.PHONY: help up fund demo deploy configure relayer transfer status logs screenshot down clean

help:
	@echo "make up      start local Besu and fund the Zenith accounts"
	@echo "make demo    deploy IBC on both chains, start the relayer, transfer a token"
	@echo "make down    stop the local chain and the relayer"
	@echo ""
	@echo "make status  what is running, balances on both chains"
	@echo "make logs    tail the relayer log"
	@echo "make clean   down, plus delete chain data and the IBC home"

up:
	@bash $(S)/setup-besu.sh
	@bash $(S)/fund.sh

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

status:
	@bash $(S)/status.sh

logs:
	@tail -f logs/relayer.log

# Re-capture the Canton linkage image used in the README.
screenshot:
	@bash $(S)/screenshot.sh

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
