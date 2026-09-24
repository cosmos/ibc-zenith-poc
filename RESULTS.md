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

## Return leg: completed, with one manual step

Zenith → Besu was scoped as best-effort because Zenith publishes no public
WebSocket. It turned out to work, and the limitation is narrower than expected.

The WebSocket drives *automatic discovery* of outbound packets. It is not
required to carry one. `ibc relayer relay --chain-id 936485 --tx-hash <send>`
names the source transaction explicitly, and the relayer builds the same
pipeline it would have built from a subscription.

**Delivery, relayed promptly** — 2 ZPOC, Zenith → Besu:

| Leg | Chain | Transaction |
|---|---|---|
| send | Zenith 936485 | `0x6fe697a127eefac80774ae3710fb3d5e4b152e0e43a408485bb6e41967976bc1` |
| recv | Besu 41003 | `0x5e5f10c646742194cfbee7c0a9583e71bcb1bc02a447ae3abf3276002be462ff` |
| ack | Zenith 936485 | `0x18b2b281891b5390ea4c750b9eecf3ae5cb655701472cfdc9f5d639a0e0a77b5` |

`PACKET_STATE_SUCCEEDED`, sequence 3. Supplies afterwards: Besu 182, Zenith 17,
verified by raw `totalSupply()` calls on both chains.

**Timeout and refund, relayed late.** The first run's stranded 1 ZPOC was
relayed about 13 minutes after its send, past the 15-minute default timeout. The
relayer carried a timeout instead of a delivery — `COMPLETE_WITH_TIMEOUT` — and
refunded on the source chain: tx
`0xe94a0919b0b2f2f1e9c039cdecde445952256ed829a60691ef9b98f7c8589c37` on Zenith
minted 1 ZPOC back from the zero address, taking Zenith from 18 to 19.

So both halves of the packet lifecycle work over this connection, in both
directions. What the missing WebSocket costs is the automatic trigger, not the
delivery. A send that nobody ever relays stays burned until someone runs the
command; nothing is unrecoverable.

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

`PACKET_STATE_SUCCEEDED`, sequence 2.

Final supplies after all runs, by raw `totalSupply()`: Besu 182, Zenith 17.

## Reproducing

```bash
make up && make demo
```

Addresses are regenerated per machine, so hashes will differ. The Besu chain is
fresh each time; Zenith is a shared public testnet and our contracts persist
there between runs.
