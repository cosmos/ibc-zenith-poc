# Demo UI: packet journey — design

2026-09-25. A browser UI that shows an IBC transfer between Besu and Zenith
step by step, for a recorded video. Source sketch:
`~/Downloads/Untitled-2026-01-08-1019.png`.

## Goal

A presenter records a video walking through one IBC transfer. The viewer sees
the two chains, the contracts on each, the attestors and the relayer, and a
packet travelling through them, with a caption for each step. The UI must
never fail on camera, and must also be able to run against the real PoC.

Success: every step in the sketch's two numbered lists is visibly shown and
captioned; a take can be recorded start to finish at 1920×1080 without
glitches; live mode shows real tx hashes from a real transfer.

## Decisions

| | Choice |
|---|---|
| Data source | Hybrid: **scripted** (default, no server) and **live** (local server drives the real PoC) |
| Pacing | Presenter-driven: `Space`/`→` next step, `←` previous, `R` restart |
| Journeys | Besu → Zenith + ack; Zenith → Besu + ack; Canton layer panel |
| Timeout/error | Caption only at the end, not animated |
| Look | Dark, clean technical; one accent per chain; glowing packet token |
| Stack | Vite + TypeScript + inline SVG, no UI framework; Node server with no dependencies |

## Layout (1920×1080)

Based on the sketch, adjusted after review. The approved mockup is
`demo-ui-mockup/mockup.html` (screenshots `step5.png`, `step8.png` alongside);
its coordinates are the reference for the build.

- **Top strip:** title, mode badge (`SCRIPTED` / `● LIVE`), and a ZPOC balance
  card per chain showing the last change (`−10`, `+10`).
- **Left column — Besu (chain 41003):** dashed chain boundary, then top to
  bottom: IFT token contract, GMP application, IBC Core router (with a
  commitment slot that fills when the commitment is written), Attestation
  light client (tracking Zenith).
- **Right column — Zenith (chain 936485):** same four boxes, same order. The
  light client reads "tracking Besu".
- **Centre line:** the Relayer (diamond) sits level with both IBC Core
  routers, so the main packet path is one horizontal line
  Core → Relayer → Core. (Changed from the sketch, where the relayer sat
  above the routers and the path zigzagged.)
- **Attestor sets:** three diamonds below the centre line on each side,
  labelled "Attestor set · watching Besu" / "· watching Zenith". Their
  signatures travel up a dashed path into the relayer. Three are drawn for
  illustration only. The PoC keeps its single attestor per chain at
  threshold 1; nothing in the PoC config or scripts changes, and the UI shows
  no attestor count or threshold.
- **Packet card:** above the relayer, visible from the `commit` step on:
  sequence, client id, app (GMP → IFT), payload (amount and short recipient
  address), timeout (send + 15 min). For the ack leg it switches to show the
  acknowledgement result.
- **Under Zenith:** Canton card, hidden until its step, joined to the Zenith
  column by a short dashed connector.
- **Bottom:** caption bar — step number, phase label, title, one-line
  explanation — plus a 16-segment progress row and a faint key hint.

Each box can show a tx hash (short form) once the step that produced it
completes. No clickable links; this is for video. Light clients show an
"updated" tick, not heights, so nothing on screen is invented.

## Steps

The same step list drives both modes. Step ids are stable; captions follow the
sketch's wording.

### Forward: Besu → Zenith

1. `user_send` — User submits transfer. IFT burns 10 ZPOC. *(Besu balance −10)*
2. `gmp_to_core` — GMP message passed to IBC Core.
3. `commit` — Core writes the packet commitment and routes toward Zenith.
4. `attest_src` — Relayer picks up the packet; Besu attestors sign it.
5. `relay_recv` — Relayer submits to Zenith Core; Zenith's light client
   (tracking Besu) is updated; Core verifies the packet against the
   attestation signatures.
6. `route_app` — Verified packet routed to GMP on Zenith.
7. `mint` — IFT mints 10 ZPOC on Zenith. *(Zenith balance +10)*
8. `canton` — Canton band: the recv tx was wrapped in a Canton
   `BlockProposal`; participant1 executes, participant2/3 re-execute. Links to
   the explorer tx.

### Ack

9. `ack_app` — Application returns a result.
10. `ack_write` — Zenith Core records the acknowledgement.
11. `attest_ack` — Zenith attestors sign the acknowledgement.
12. `relay_ack` — Relayer picks up the ack and its proof.
13. `ack_submit` — Relayer submits to Besu Core and updates Besu's light client.
14. `ack_verify` — Ack verified against its signatures.
15. `ack_done` — Ack delivered to the IFT contract. Transfer complete.
16. `outro` — Caption: "If the packet errors or times out, that result is
    relayed back instead and the IFT re-mints the burned tokens to the sender."

### Return: Zenith → Besu

The same steps mirrored (source and destination swapped, 2 ZPOC). Zenith is
now the source, so the `canton` step comes right after `user_send` (the burn
on Zenith) instead of after `mint`.

The presenter picks the journey from a small menu before starting (key `1` /
`2`), which is hidden during a take.

## Animation

- The packet token is a small glowing rounded square that travels along SVG
  paths between components (the arrows in the sketch). The active component
  gets an accent glow and its box border brightens; finished components dim
  back but keep their tx hash.
- Attestor signing: the three diamonds light up in sequence, each emitting a
  small signature tick that flies to the relayer.
- Light client update: a brief "height ↑" tick inside the light client box.
- Balances animate their number change.
- `←` jumps to the previous step's end state instantly (no reverse animation).

## Modes and the event model

Both modes produce the same thing: a sequence of **checkpoint events** carrying
data. The step engine owns presentation; the event source only unlocks steps
and fills in data.

```ts
type Checkpoint =
  | { kind: 'sent';       chain: number; txHash: string }
  | { kind: 'received';   chain: number; txHash: string }   // recv on dest
  | { kind: 'acked';      chain: number; txHash: string }   // ack on source
  | { kind: 'complete';   status: 'COMPLETE_WITH_ACK' | 'COMPLETE_WITH_TIMEOUT' | string }
  | { kind: 'balances';   besu: string; zenith: string }    // whole-token strings
  | { kind: 'error';      message: string };
```

Each step declares which checkpoint (if any) it needs: steps 1–3 need `sent`,
steps 5–8 need `received`, steps 13–15 need `acked`. Steps 4, 9–12 need
nothing beyond their predecessor. Pressing next on a step whose checkpoint has
not arrived shows a "waiting for <chain> block…" pulse in the caption bar and
advances automatically once it arrives.

### Scripted source

A static JSON timeline per journey, built from RESULTS.md: forward send
`0x7287…900e`, recv `0xeb04…124c`, ack `0x15be…9a46`; return send
`0x6fe6…6bc1`, recv `0x5e5f…62ff`, ack `0x18b2…77b5`. Balances follow the
first run for forward (100/0 → 90/10) and continue from there for return
(90/10 → 92/8); RESULTS.md's cumulative totals after several runs would read
oddly on camera.
All checkpoints are available immediately, so it never waits. No server needed:
the built page works from `file://` or any static host.

### Live source

`demo-ui/server/` — a Node server (no dependencies), default port 3200 (3000
and 3100 are taken). It serves the built page and exposes:

- `POST /api/transfer {direction: 'forward' | 'return'}` — runs the transfer
  with the same commands `scripts/transfer.sh` uses, via `bash -c 'source
  scripts/env.sh && ibc …'`. Forward: `ibc tx ift send` on Besu (the relayer
  auto-relays). Return: `ibc tx ift send` on Zenith, waits ~8s, then
  `ibc relayer relay --chain-id 936485 --tx-hash <send>`.
- `GET /api/events` — Server-Sent Events stream of checkpoints.

Checkpoint sources: after the send, the server polls
`ibc relayer packets --chain-id <src> --tx-hash <send>` every 2s. That one
call returns `state`, `sequenceNumber`, `recvTx`, `ackTx` and `timeoutTx`, so
`sequence`, `received`, `acked` and `complete` are all diffs of successive
responses. (Earlier drafts tailed `logs/relayer.log`; the packet query carries
the same information with no log parsing.) `balances` comes from
`ibc query ift balance` on both chains before the send.

The page is in live mode when loaded with `?live`. If `/api/health` fails,
it stays in live mode and names the problem on the ready screen rather than
silently switching data sources; `S` switches to scripted.

Preconditions for live (checked by `/api/health`, shown in the top strip if
failing): Besu answering, relayer running, IBC deployed. The server does not
start chains or the relayer; `make up && make demo` must have run once.

### Errors in live mode

A failed CLI call or a `complete` status other than `COMPLETE_WITH_ACK` emits
`error`. The caption bar shows it plainly in amber. The presenter can press `S`
at any time to switch the remaining steps to scripted data, so the take can
continue.

## Files

```
demo-ui/
  index.html
  src/
    main.ts          keyboard, mode selection, wiring
    diagram.ts       builds the SVG layout; exposes component + path handles
    steps.ts         the step list for both journeys (captions, targets, required checkpoint)
    engine.ts        step state machine: current step, gating on checkpoints, back/restart
    animate.ts       token travel, glows, attestor signing, balance tween
    sources/
      scripted.ts    replays timelines/*.json
      live.ts        EventSource client for /api/events
    timelines/forward.json, return.json
    style.css        tokens: colours, type, glow
  server/
    server.mjs       http + SSE + static
    ibc.mjs          runs ibc commands via env.sh; parses output
    relayerlog.mjs   tails relayer.log, yields checkpoints
  package.json       vite, typescript (dev only)
```

Makefile gains `make ui` (scripted dev server) and `make ui-live` (build, then
start the live server).

## Testing

- Unit (vitest): the engine's gating (a step waits, then advances when its
  checkpoint arrives; back/restart), and `relayerlog.mjs` parsing against lines
  copied from the real `logs/relayer.log`.
- Manual: a full scripted take for both journeys at 1920×1080; one live
  forward transfer against the running PoC.

## Out of scope

Animated timeout/refund, wallet connection or user input of amounts, deploying
or starting chains from the UI, mobile layout, hosting.
