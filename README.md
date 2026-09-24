# Besu ↔ Zenith IBC PoC

A working IBC connection between a local Hyperledger Besu chain and **Zenith**,
the EVM execution layer of the Canton Network. An Interchain Fungible Token is
burned on Besu and minted on Zenith, carried by our own attestors and relayer,
using the `ibc` CLI with no changes to any contract.

**What this proves:** the IBC Solidity stack — ICS26 router, attestation light
client, GMP, IFT — deploys and runs unmodified on Canton's EVM layer, and packet
delivery there settles through Canton consensus.

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
participants. Our packet delivery inherits that: the receive transaction has an
originating Canton transaction, visible in the explorer. See
[RESULTS.md](RESULTS.md).

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

Expected finish:

```
ok  packet SUCCEEDED
    Besu 41003: 90.0 ZPOC
    Zenith 936485: 10.0 ZPOC
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

**The return leg does not auto-relay.** Zenith publishes no public WebSocket —
`ws.testnet.zenith.network` does not resolve and the RPC host rejects the
upgrade. The relayer subscribes over a WebSocket to source auto-relayed
packets, and `config validate` fails outright if `autoRelay` is enabled on a
chain without one, so it is enabled on the Besu end only. Besu → Zenith is
automatic; Zenith → Besu is not.

**A Zenith → Besu send strands its tokens.** `make demo` attempts the return
leg, and the send succeeds and burns on Zenith — but with nothing watching that
end, the packet is never carried and the timeout/refund path is not carried
either. Those tokens do not come back on their own. This is a property of the
demo's configuration, not of IBC; a relayer with a Zenith WebSocket, or a
manual submission, would complete it.

**Everything is a demo trust set.** One attestor per chain, threshold 1, keys
generated locally with no ceremony, and a single-validator Besu chain. Read the
trust model before quoting any of this.

**Zenith testnet is a dependency we do not control.** It is operated by a
seed-stage company, and we have no read on its uptime or reset policy. Treat
this as reproducible on demand, not as a demo that stays live.

## Reaching Canton

The obvious next question is whether the same handler can reach a real Daml
asset. It cannot, as built, and the reason is directional.

Zenith's `external_call()` is implemented **in Daml** and lets Daml contracts
invoke the EVM — not the reverse. There is no outbound door from the EVM side: a
Solidity contract on Zenith cannot call into Daml. So:

- **Canton → Besu** is the clean direction. A Daml contract could burn a CIP-56
  token and `external_call()` our Solidity handler to emit the packet,
  atomically, in one Canton transaction.
- **Besu → Canton** is the hard one. The packet lands on Zenith EVM and nothing
  there can mint the Daml token. The relayer would have to submit a Canton
  transaction itself, against a participant node.

That second point is the same conclusion reached independently from the
protocol side: the IBC component has to speak the Canton protocol rather than
fetch headers and proofs over RPC. Closing the gap needs Daml templates on
CIP-56, a stakeholder design that lets the relayer or attestor read packet
commitments, and a relayer adapter for the participant ledger API.

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
docs/                    design spec and measured Zenith facts
RESULTS.md               the run: transaction hashes, balances, Canton linkage
```
