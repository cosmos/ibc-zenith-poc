# Besu ↔ Zenith IBC PoC — design

Evan + Claude, 2026-09-24. Status: built and run — see Outcome at the end.

## What this proves

One IFT transfer over IBC between a local Besu chain and Zenith, the EVM
execution layer of the Canton Network, using our shipped attestor trust model
and the `ibc` CLI unmodified.

## What this does not prove

It does not reach Canton. Zenith is an EVM layer that routes its transactions
through the Canton protocol; the assets institutions hold on Canton are Daml
contracts on their own participant nodes, reachable only through Zenith's
`external_call()` into Daml. Nothing here touches Daml. The honest headline is
"IBC runs on Canton's EVM layer," not "IBC reaches Canton."

This distinction is the substance of Barry's Aug 5 pushback in `#wg-lfdt-gtm`:
integrating Zenith is easy and means less than integrating Canton. The PoC is
worth doing anyway because it is cheap, it de-risks the EVM half so only the
Daml half remains unknown, and it gives the Aug 26 public Canton light-client
commitment something real to point at while the honest answer is worked out.

## Measured facts about Zenith testnet

Verified by direct RPC on 2026-09-24. Not taken from docs.

| Property | Value |
|---|---|
| RPC | `https://rpc.testnet.zenith.network` — public, no auth, no API key |
| Chain ID | 936485 (`0xe4a25`) |
| Client | `reth/v2.0.0-eb4c15e` |
| Block time | 5.005s, flat over 200 blocks |
| Finality | `finalized` == `safe` == head — deterministic |
| Base fee | 7 wei; gas limit 30,000,000 |
| Header | Post-Prague: real `stateRoot`, `requestsHash`, `withdrawalsRoot` |
| `eth_getProof` | Works, returns real MPT account proofs |
| `eth_getLogs` | Works |
| Precompiles | ecrecover, sha256, modexp, bn254 add, bn254 pairing all present |
| Write path | `eth_sendRawTransaction` reaches the tx decoder, no authz wall |
| Faucet | `POST /api/faucet` — scriptable, no captcha. 100 ZTH per address / 30 min |
| Activity | Sparse, not idle. 8 sampled blocks were empty, but the explorer reports 25,240 indexed EVM txs and 25,126 linked Canton txs |
| WebSocket | **None found.** `ws.testnet.zenith.network` does not resolve; the RPC host returns 405 on upgrade |

## Topology

Chain A is a local single-validator Besu QBFT chain we own. Chain B is Zenith
testnet — remote, public, and not ours. Otherwise the shape matches the IBC CLI
tutorial: an attestation light client on each side, a 1-of-1 attestor per
chain, GMP and IFT contracts on both, and the relayer in dual mode with the
attestors running in its process.

The crossed pairing holds as in the tutorial: the client on Besu tracks Zenith
and trusts the attestor watching Zenith, and vice versa.

## Deltas from the tutorial

The tutorial assumes two chains you own and funded at genesis. Five things change.

1. **No genesis funding on Zenith.** The deployer and relayer keys need ZTH from
   the faucet before anything deploys. Per-request amount, rate limits, and
   whether it is captcha-gated are unknown. This is the first gate.
2. **No WebSocket on Zenith.** `evm.ws` is optional except for a chain sourcing
   auto-relayed routes, and config validation fails if `autoRelay` is enabled on
   an end whose chain has no WS. So `autoRelay` goes on the Besu end only.
   Besu → Zenith relays automatically; Zenith → Besu does not.
3. **Remote chain, 5s blocks.** Finality offset can be 0.
4. **Port and container collisions** with a Besu pair already running on this
   machine under another agent.
5. **`~/.ibc` is occupied** by that agent's state.

## Isolation contract

Another agent is running `besu-a` (8545/8546/9545) and `besu-b`
(8745/8746/9745) on this machine. These rules are not optional.

- Never run anything inside `ibc-dogfood/ibc/examples/besu-to-besu/`. Its
  `clean()` runs `docker compose down -v --remove-orphans`, and `container_name`
  is hardcoded to `besu-a`/`besu-b` — container names are global in Docker, so
  even a copy of the directory collides.
- Our Besu: container `besu-zpoc`, host ports **8945/8946/9945**, its own
  volume, network, and compose project name.
- Our CLI state: `--home ~/.ibc-zpoc` on every invocation. Nothing writes to
  `~/.ibc`.
- Relayer server on **3100**, not 3000.
- `ibc-dogfood` is read-only. Copy out, never edit in place.

## Repo layout

```
ibc-zenith-poc/
├── README.md              architecture in brief, then the commands
├── Makefile               the command surface
├── docker-compose.yml     the local Besu container
├── chains/                besu.toml + genesis templates; chains/local is generated
├── scripts/
│   ├── env.sh             shared config: endpoints, ports, helpers
│   ├── setup-besu.sh      keys, genesis, container, wait for RPC
│   ├── fund.sh            faucet top-up via POST /api/faucet
│   ├── deploy.sh          register chains, deploy core/client/gmp/ift, link
│   ├── configure.sh       render relayer config, disable Zenith auto-relay, validate
│   ├── relayer.sh         start | stop | status
│   ├── transfer.sh        mint, send, wait, report; then the return leg
│   └── status.sh          what is running and where the tokens are
├── docs/                  this design spec
└── RESULTS.md             tx hashes, balances, Canton linkage
```

## Command surface

The README opens with a short architecture description, then three commands:

```
make up       # start local Besu, verify Zenith reachable and funded
make demo     # deploy IBC both sides, start relayer, run the transfer
make down     # stop and clean our containers only
```

`make demo` must be idempotent enough to re-run after a failure without manual
cleanup, and must print the tx hashes and explorer links it produced.

Funding *is* a `make` target after all. The spec assumed the faucet would need
a human in a browser; it turned out to expose a plain `POST /api/faucet` with no
captcha, so `make up` claims gas directly and skips accounts that already hold
some. If a claim is declined it warns and prints the address and faucet URL
rather than failing the run.

## Phases

1. **Fund.** Faucet ZTH to deployer and relayer on Zenith; confirm balances.
   Gate: if the faucet will not fund us, everything below stops and Zenith
   becomes a human conversation. **Cleared** — scriptable, 100 ZTH each.
2. **Local Besu up** on reserved ports; verify chain ID and block production.
3. **Config and keys** under `--home ~/.ibc-zpoc`; both chains registered;
   `autoRelay` on the Besu end only.
4. **Deploy** core, client, gmp, ift on both sides; `ift-bridge` to link them.
   This is the real test of Zenith's EVM — the router-behind-proxy deploy is the
   largest bytecode we push.
5. **Relayer up**; `config validate --live --strict` returns clean.
6. **Transfer Besu → Zenith**; confirm `PACKET_STATE_SUCCEEDED` and balances on
   both sides.
7. **Return leg Zenith → Besu**, best-effort. Not a blocker.
8. **Write up** RESULTS.md, README, and a worklog entry in the docs repo.

## Risks and fallbacks

| Risk | Fallback |
|---|---|
| Faucet will not fund, or rate-limits below what deployment costs | Blocks the PoC. First thing needing a human at Zenith. |
| No WS kills the Zenith → Besu leg | Best-effort by decision. Probe for an undocumented WS path; if none, ship one direction and document why. A polling-to-`eth_subscribe` shim is explicitly out of scope. |
| Zenith rejects a large deploy, or has non-standard gas accounting | Fall back to a smaller IFT-only deployment. Record the failure — a reproducible "Zenith cannot host our router" is a real result. |
| Testnet resets or goes down mid-demo | Capture tx hashes and explorer links the moment they exist. The demo is reproducible-on-demand, not always-live. A seed-stage company's testnet is a dependency worth naming out loud. |
| Zenith EVM state turns out to be privacy-scoped per stakeholder | Would surface as attestors unable to read what they need. Unknown from public sources and untestable against an idle chain; note it if it appears. |

## Done

One IFT transfer Besu → Zenith reaching `PACKET_STATE_SUCCEEDED`, balances
debited and credited, tx hashes recorded on both explorers. Return leg attempted
and its outcome documented either way. README with architecture and working
commands. Nothing pushed, nothing published.

## Out of scope

A UI, sustained relaying, gas benchmarks, any Daml, any `external_call()`, a
CometBFT client against the Global Synchronizer, and publishing.

## Outcome, 2026-09-24

Built and run. Besu → Zenith transfer reached `PACKET_STATE_SUCCEEDED`; the full
IBC Solidity stack deployed on Zenith unmodified; the receive transaction
carries an originating Canton transaction under the Daml template
`Zenith.Evm.Rules:BlockProposal`. The return leg was attempted and did not
complete, as anticipated — and it strands the tokens it burns, which the spec
did not anticipate and the README now states plainly.

Corrections to this spec, from the build:

- The faucet is scriptable; the "funding is not a make target" decision was
  wrong and has been reversed above.
- "Idle chain" was an over-reading of an 8-block sample. Corrected above.
- `ibc deploy` is genuinely idempotent ("step satisfied, skipping"), so
  `make demo` can be re-run safely. Not known when the spec was written.

Evidence: [RESULTS.md](../RESULTS.md).
