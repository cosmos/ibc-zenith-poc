# Besu ↔ Zenith IBC PoC

A working IBC connection between a local Hyperledger Besu chain and **Zenith**,
the EVM execution layer of the Canton Network. An Interchain Fungible Token is
burned on Besu and minted on Zenith, carried by our own attestors and relayer,
using the `ibc` CLI with no changes to any contract.

**What's included in this demo** the IBC Solidity stack — ICS26 router, attestation light
client, GMP, IFT — deploys and runs unmodified on Canton's EVM layer; tokens
move in **both directions**; and packet delivery there settles through Canton
consensus.

## Architecture

```
        Besu (local, chain 41003)                Zenith testnet (chain 936485)
    ┌──────────────────────────────┐          ┌──────────────────────────────┐
    │  ICS26 Router + AccessMgr    │          │  ICS26 Router + AccessMgr    │
    │  Attestation client ─────────┼──tracks──┤  (identical Solidity)        │
    │  GMP · IFT (ZPOC)            │          │  GMP · IFT (ZPOC)            │
    └──────────────┬───────────────┘          └───────────────┬──────────────┘
                   │                                          │
                   │        ┌──────────────────────┐          │
                   └────────┤  relayer + attestors ├──────────┘
                            │   (one process)      │
                            └──────────────────────┘
                                                        ▼ every Zenith block
                                              ┌──────────────────────────────┐
                                              │ Canton: Daml BlockProposal,  │
                                              │ re-executed by 3 participants│
                                              └──────────────────────────────┘
```

Each chain runs an attestation light client that tracks the other. The pairing
is crossed: the client on Besu trusts the attestor watching Zenith, and vice
versa. A transfer burns ZPOC on the source chain and mints it on the
destination when the packet is delivered. Threshold is 1-of-1 — a demo trust
set, not a production one.

The layer below is what makes Zenith more than an ordinary EVM chain. Every
Zenith block is wrapped by Zenith's relayer into a Canton transaction under the
Daml template `Zenith.Evm.Rules:BlockProposal` and re-executed by three Canton
participants. Our packet delivery inherits that:

![Zenith explorer showing our IBC packet-delivery transaction with its
originating Canton transaction: Daml template Zenith.Evm.Rules:BlockProposal,
Canton update id, command id, and a lifecycle of three participants executing
and re-executing](docs/img/canton-linkage.png)

*The IBC `recvPacket` that minted 10 ZPOC on Zenith
([tx `0xeb0417e1…a397124c`](https://explorer.testnet.zenith.network/tx/0xeb0417e13abbfe9549d6de3ed9ceb4caf0432e2666cdbb1bf36d9853a397124c)),
shown with the Canton transaction it originated from. Regenerate with
`make screenshot`.*

Read that panel precisely. The Daml template is `BlockProposal`: Zenith wraps an
EVM **block** into a Canton transaction, and our packet delivery is one
transaction inside it. Our IBC packet is not itself a Daml contract. The
per-step timings are labelled illustrative by the page itself.

## Run it

Prerequisites: Docker with the compose plugin, Go 1.25+, Node 20+, `jq`,
`perl`, and Foundry's `cast`.

```bash
make up        # start the local Besu chain, create keys, get Zenith gas from the faucet
make demo      # deploy IBC on both chains, start the relayer, send a token
make ui-live   # start the demo UI against the running PoC
```

Then open <http://localhost:3200/?live>.

### What `make demo` does

It registers both chains with the `ibc` CLI, deploys the IBC stack on each
(ICS26 router, an attestation light client tracking the other chain, GMP, and
the ZPOC IFT token), links the two tokens, and starts the relayer. Then it
mints 100 ZPOC on Besu and sends 10 to Zenith over IBC. It finishes with:

```
ok  packet SUCCEEDED
```

and balances of Besu 90 / Zenith 10 ZPOC. The PoC keeps running afterwards.

### The demo UI

![The demo UI mid-transfer: Besu on the left, Zenith on the right, the relayer
between them, the packet arriving at IBC Core on Zenith, and the live log in the
bottom-left corner](docs/img/demo-ui.png)

One transfer, step by step, built for recording: the contracts on each chain,
the attestor sets and the relayer between them, and the packet moving
IFT → GMP → IBC Core → relayer → IBC Core → GMP → IFT, then the ack back. Each
step has a caption, and the top bar shows ZPOC on both chains.

**Live** (`make ui-live`, <http://localhost:3200/?live>). Press `1` for
Besu → Zenith or `2` for Zenith → Besu, then `Space` to send 10 ZPOC for real.
The UI then plays itself as the transfer happens: each step stays up for a few
seconds, and a step that needs the chain holds on "Waiting for…" until the
relayer reports it. A transfer takes about a minute. The live log in the corner
shows the commands being run and the relayer's own log as it goes. The balances
are the real ones on chain, so they carry over between takes; a forward run
followed by a return run brings them back to where they started.

**Recorded** (`make ui`, <http://localhost:5173>). The same screens, stepped
through by hand with `Space`, using the real transactions from
[RESULTS.md](RESULTS.md). It needs no chains, never waits, and cannot fail
mid-take.

| Key | |
|---|---|
| `1` / `2` | forward or return journey (ready screen) |
| `Space` / `→` | send (ready screen); next step; in live mode, skip ahead |
| `←` | previous step (pauses live mode) |
| `P` | pause or resume (live) |
| `L` | show or hide the live log (live) |
| `S` | a live take went wrong: continue from recorded data (live) |
| `R` | back to the ready screen |

Three attestors are drawn per chain for illustration; the PoC runs one per chain
at threshold 1. Design:
[docs/superpowers/specs/2026-09-25-demo-ui-design.md](docs/superpowers/specs/2026-09-25-demo-ui-design.md).

## Other commands

| Command | |
|---|---|
| `make status` | what is running; gas and ZPOC balances on both chains |
| `make logs` | follow the relayer log |
| `make return` | send 10 ZPOC back, Zenith → Besu (relayed by hand; see [Known limits](#known-limits)) |
| `make ui` | the demo UI with recorded data, <http://localhost:5173> |
| `make down` | stop the relayer and the local chain |
| `make up && make relayer` | bring it back after a reboot or `make down`, without redeploying |
| `make fund` | top up ZTH gas on Zenith from the faucet |
| `make clean` | full reset: deletes the local chain, logs, and this PoC's IBC home (`~/.ibc-zpoc`) |
| `make screenshot` | re-capture the Canton explorer image in [Architecture](#architecture) |

`make up` is safe to re-run and skips a faucet claim when the accounts already
hold gas. `make demo` is safe to re-run after a failure.

**Start fresh**, for example when the demo UI says the contracts are missing on
Zenith (the testnet has been reset):

```bash
cp -a ~/.ibc-zpoc ~/.ibc-zpoc.bak    # keep the old keys, just in case
make clean && make up && make demo
```

For screenshots of the UI, `?step=N&journey=forward|return` opens a recorded
step directly, and `demo-ui/scripts/shot.sh` captures it at 1920×1080.

## Isolation

This repo was built on a machine already running the `ibc-dogfood`
`besu-to-besu` example, and it stays out of its way on purpose:

| | this PoC | the example |
|---|---|---|
| container | `besu-zpoc` | `besu-a`, `besu-b` |
| RPC / WS / metrics | 8945 / 8946 / 9945 | 8545 / 8745, … |
| relayer HTTP | 3100 | 3000 |
| CLI home | `~/.ibc-zpoc` | `~/.ibc` |

`make clean` removes only this PoC's container, volume, and `~/.ibc-zpoc`.
Nothing here ever runs inside the example's directory, whose `clean` does a
`docker compose down -v --remove-orphans` and whose container names are
hardcoded.

## Known limits

**The return leg needs one extra command.** Zenith publishes no public
WebSocket — `ws.testnet.zenith.network` does not resolve and the RPC host
rejects the upgrade. The relayer subscribes over a WebSocket to *discover*
packets automatically, and `config validate` fails outright if `autoRelay` is
enabled on a chain without one, so it is on the Besu end only.

That costs automation, not capability. `ibc relayer relay --chain-id 936485
--tx-hash <send>` names the source transaction explicitly, and the same
pipeline carries the packet. `make return` does this and completes the round
trip. A Zenith WebSocket would remove the extra call; nothing else is missing.

**Relay the return leg promptly.** A packet's timeout defaults to 15 minutes
from the send. Relayed inside that window it delivers; relayed after it, the
same command carries a timeout instead and refunds the tokens on the source
chain. Both paths were exercised here — see [RESULTS.md](RESULTS.md). Tokens
are never lost, but a send that is never relayed at all stays burned until
someone runs the command.


## Layout

```
Makefile                 the command surface (make help)
docker-compose.yml       the local Besu containers
chains/                  besu.toml + genesis templates; chains/local is generated
scripts/
  env.sh                 shared config: endpoints, ports, helpers
  setup-besu.sh          keys, genesis, container, wait for RPC
  fund.sh                faucet top-up via POST /api/faucet
  deploy.sh              register chains, deploy core/client/gmp/ift, link tokens
  configure.sh           render relayer config, disable Zenith auto-relay, validate
  relayer.sh             start | stop | status
  transfer.sh            mint, send, wait, report
  return.sh              the return leg, relayed by hand
  status.sh              what is running and where the tokens are
  screenshot.sh          re-capture the Canton linkage image (make screenshot)
demo-ui/                 the demo UI: Vite + TypeScript page, live server in server/
docs/                    design spec, measured Zenith facts, img/
RESULTS.md               the run: transaction hashes, balances, Canton linkage
```

## Trademarks

Canton is a registered trademark of Digital Asset (Switzerland) GmbH. Digital Asset is not affiliated with, and has not sponsored or endorsed, this offering.
