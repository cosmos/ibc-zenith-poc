# Run results

2026-09-24. Local Besu chain 41003 ↔ Zenith testnet chain 936485.
Everything below is from the run, not from documentation.

## Outcome

An Interchain Fungible Token moved from Besu to Zenith over IBC and the packet
reported `PACKET_STATE_SUCCEEDED`. The whole IBC Solidity stack deployed on
Zenith unmodified.

| | Besu 41003 | Zenith 936485 |
|---|---|---|
| ZPOC before | 100 | 0 |
| ZPOC after | 90 | 10 |

## The transfer

Client id `link-41003-936485`. IFT contract deployed at the same address on both
chains, `0xEc3c7834d0597C8F72C13093D3349917E9EfEa23`, because the same deployer
key ran the same nonce sequence on each.

| Leg | Chain | Transaction |
|---|---|---|
| send | Besu 41003 | `0x728727ad87269585daac3b16af4f919dcb17cc36c1f8117d74094a56ea04900e` |
| recv | Zenith 936485 | `0xeb0417e13abbfe9549d6de3ed9ceb4caf0432e2666cdbb1bf36d9853a397124c` |
| ack | Besu 41003 | `0x15bea9bff0d6284a2fb2c2f301fa055baa042680b7ecc948c39200599f199a46` |

The receive on Zenith:
<https://explorer.testnet.zenith.network/tx/0xeb0417e13abbfe9549d6de3ed9ceb4caf0432e2666cdbb1bf36d9853a397124c>

## Canton linkage

This is the part that distinguishes Zenith from any other EVM chain. The
explorer shows our receive transaction with an originating Canton transaction:

| Field | Value |
|---|---|
| Canton update | `12206550d1…552d228d` |
| Command id | `0550098f0790…3c6804d9` |
| Daml template | `77e0a44b32dbf894220a7edd0513333948973d4eb6e95b148b1897d8526f526a:Zenith.Evm.Rules:BlockProposal` |
| Canton record time | 2026-09-24 11:17:57 EDT |
| EVM block timestamp | 2026-09-24 11:18:02 EDT |
| Validators | participant1 executes, participant2 and participant3 re-execute (REVM) |
| Lifecycle label | Bridge In · Canton → EVM |

Read this precisely. The Daml template is `BlockProposal`: Zenith's relayer
wraps an **EVM block** into a Canton transaction, and our packet delivery is one
transaction inside that block. Our IBC packet is not itself a Daml contract.
What is true is that the execution containing it was validated by three Canton
participants and committed through Canton consensus, and the explorer
correlates the two. The explorer also labels its timing breakdown an
"illustrative visualization" with estimated per-step durations, so treat the
5.3s lifecycle figure as indicative.

## Return leg: attempted, did not complete

Zenith → Besu was in scope as best-effort only, because Zenith publishes no
public WebSocket and the relayer needs one to source auto-relayed packets.

The send succeeded on Zenith — tx
`0xe39af1b5c2bc941465083aff8d4f19e6c9e4efcf87c3bf49c69a0e040d6de91b`, block
576051 — and burned 1 ZPOC, taking the Zenith balance from 10 to 9. The packet
then reported `UNKNOWN`: nothing was watching that end to carry it, and nothing
carried the timeout home either. Those tokens are stranded by the demo's
configuration. IBC behaved correctly; the relayer was simply not subscribed.

## Measured facts about Zenith

Verified by direct RPC and by this run.

| Property | Value |
|---|---|
| RPC | `https://rpc.testnet.zenith.network` — public, no auth, no API key |
| Chain ID | 936485 (`0xe4a25`) |
| Client | `reth/v2.0.0-eb4c15e` |
| Block time | 5.005s, flat over 200 blocks |
| Finality | `finalized` == `safe` == head |
| Base fee | 7 wei; gas limit 30,000,000 |
| `eth_getProof` | works, real MPT account proofs |
| Precompiles | ecrecover, sha256, modexp, bn254 add, bn254 pairing |
| Faucet | `POST /api/faucet` — scriptable, no captcha, 100 ZTH per address / 30 min |
| Contract verification | Etherscan-compatible, works with `forge verify-contract` |
| WebSocket | none found |
| Explorer health | `canton` online, `evm` online, `zenith` reported offline |

**Cost of the entire exercise:** under 0.0000000002 ZTH of gas across both
accounts — deploying core, a light client, GMP and IFT on Zenith, plus the
packet receive. Gas is not a constraint on this chain.

**On chain activity.** An earlier sample of 8 blocks spread across the chain's
history found all of them empty, which suggested an idle chain. That inference
was too strong: the explorer reports 25,240 indexed EVM transactions and 25,126
linked Canton transactions, most of them block publications. The chain is
sparse, not unused.

## Second run: reproducibility

`make demo` was re-run from the documented path to verify the command surface.
`ibc deploy` reported "step satisfied, skipping" for every contract, the config
re-validated against both live chains, the relayer restarted, and a second
packet went through.

| Leg | Chain | Transaction |
|---|---|---|
| send | Besu 41003 | `0x29b218ebd1221b219b1ab778e2c9042f0b6b5c5c50a5417131c0b4e56d905acb` |
| recv | Zenith 936485 | `0x54887c663565131f4b3046dadb6440f526edb781db1b20061f8a8038e147f1f2` |
| ack | Besu 41003 | `0x888494733ab8f004516d3ddcfc660733983e625bea2e0c83e96b6f55fe66dbf3` |

`PACKET_STATE_SUCCEEDED`, sequence 2. The return leg was attempted again and
again stranded 1 ZPOC on Zenith, consistent with the first run.

Final balances after two runs: Besu 180 ZPOC, Zenith 18 ZPOC (200 minted, 20
transferred in, 2 burned into stranded return packets).

## Reproducing

```bash
make up && make demo
```

Addresses are regenerated per machine, so hashes will differ. The Besu chain is
fresh each time; Zenith is a shared public testnet and our contracts persist
there between runs.
