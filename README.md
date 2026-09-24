# Besu ↔ Zenith IBC PoC

A working IBC connection between a local Hyperledger Besu chain and **Zenith**,
the EVM execution layer of the Canton Network. An Interchain Fungible Token is
burned on Besu and minted on Zenith, carried by our own attestors and relayer,
using the `ibc` CLI with no changes to any contract.

**What this proves:** the IBC Solidity stack — ICS26 router, attestation light
client, GMP, IFT — deploys and runs unmodified on Canton's EVM layer; tokens
move in **both directions**; and packet delivery there settles through Canton
consensus.

**What this does not prove:** that IBC reaches Canton. The assets institutions
hold on Canton (JPM Coin, DTCC's tokenized Treasuries, anything CIP-56) are Daml
contracts on their own participant nodes. Nothing here touches Daml. See
[Reaching Canton](#reaching-canton) for why the remaining gap is not a
formality.

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

Prerequisites: Docker with the compose plugin, Go 1.25+, `jq`, `perl`, and
Foundry's `cast`.

```bash
make up      # start the local Besu chain, fund the Zenith accounts from the faucet
make demo    # deploy IBC on both chains, start the relayer, transfer a token
make down    # stop the relayer and the local chain
```

`make up` is safe to re-run and skips a faucet claim when the accounts already
hold gas. `make demo` is idempotent enough to re-run after a failure.

Also available: `make status` (what is running, balances on both chains),
`make logs` (tail the relayer), `make clean` (full reset, including this PoC's
IBC home).

Expected finish: a packet out and a packet back.

```
ok  packet SUCCEEDED                 # Besu -> Zenith, auto-relayed
ok  return packet SUCCEEDED — full round trip   # Zenith -> Besu, relayed by hand
```

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
pipeline carries the packet. `make demo` does this and completes the round
trip. A Zenith WebSocket would remove the extra call; nothing else is missing.

**Relay the return leg promptly.** A packet's timeout defaults to 15 minutes
from the send. Relayed inside that window it delivers; relayed after it, the
same command carries a timeout instead and refunds the tokens on the source
chain. Both paths were exercised here — see [RESULTS.md](RESULTS.md). Tokens
are never lost, but a send that is never relayed at all stays burned until
someone runs the command.

**Everything is a demo trust set.** One attestor per chain, threshold 1, keys
generated locally with no ceremony, and a single-validator Besu chain. Read the
trust model before quoting any of this.

**Zenith testnet is a dependency we do not control.** It is operated by a
seed-stage company, and we have no read on its uptime or reset policy. Treat
this as reproducible on demand, not as a demo that stays live.

## Reaching Canton

`external_call()` runs Daml → EVM only, so a Solidity contract on Zenith cannot
call into Daml: reaching a CIP-56 asset needs Daml templates plus a relayer that
speaks the Canton ledger API.
See the [design doc](docs/2026-09-24-besu-zenith-ibc-design.md#reaching-canton)
for what that would take.

## Layout

```
Makefile                 the three commands
docker-compose.yml       the local Besu container
chains/                  besu.toml + genesis templates; chains/local is generated
scripts/
  env.sh                 shared config: endpoints, ports, helpers
  setup-besu.sh          keys, genesis, container, wait for RPC
  fund.sh                faucet top-up via POST /api/faucet
  deploy.sh              register chains, deploy core/client/gmp/ift, link tokens
  configure.sh           render relayer config, disable Zenith auto-relay, validate
  relayer.sh             start | stop | status
  transfer.sh            mint, send, wait, report; then the return leg
  status.sh              what is running and where the tokens are
  screenshot.sh          re-capture the Canton linkage image (make screenshot)
docs/                    design spec, measured Zenith facts, img/
RESULTS.md               the run: transaction hashes, balances, Canton linkage
```
