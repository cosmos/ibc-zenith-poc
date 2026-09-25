// The step lists for both journeys. Steps are written in terms of the source
// (S) and destination (D) chain, so the return journey reuses them mirrored.

import type { Direction, EdgeId, EdgePart, JourneyData, Need, NodeId, Part, Scene, Side } from './types';

type Role = 'S' | 'D';
export type NodeRole = `${Role}.${Part}` | 'relayer' | 'canton';
export type EdgeRole = `${Role}.${EdgePart}`;

export interface Journey {
  direction: Direction;
  src: Side;
  dst: Side;
  amount: number;
  steps: StepDef[];
}

export interface Ctx {
  journey: Journey;
  data: JourneyData;
}

export interface StepDef {
  id: string;
  needs: Need | null;
  phase: 'send' | 'ack' | 'end';
  title: (c: Ctx) => string;
  body: (c: Ctx) => string;
  active: NodeRole[];
  moves: { edge: EdgeRole; reverse: boolean }[];
  /** Attestors on this side sign during the step. */
  sign?: Role;
  /** This side's light client shows an update tick. */
  lcTick?: Role;
  /** Persistent changes: hashes, balances, slots, cards. */
  effect?: (s: Scene, c: Ctx) => void;
}

export const CLIENT_ID = 'link-41003-936485';

// On screen the Zenith side is named for the network it belongs to: Canton.
export const sideName = (s: Side) => (s === 'b' ? 'Besu' : 'Canton');
export const short = (h: string | undefined) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '…');

export const resolveSide = (j: Journey, r: Role): Side => (r === 'S' ? j.src : j.dst);
export function resolveNode(j: Journey, r: NodeRole): NodeId {
  if (r === 'relayer' || r === 'canton') return r;
  const [role, part] = r.split('.') as [Role, Part];
  return `${resolveSide(j, role)}-${part}`;
}
export function resolveEdge(j: Journey, r: EdgeRole): EdgeId {
  const [role, part] = r.split('.') as [Role, EdgePart];
  return `${resolveSide(j, role)}-${part}`;
}

const S = (c: Ctx) => sideName(c.journey.src);
const D = (c: Ctx) => sideName(c.journey.dst);
const amt = (c: Ctx) => c.journey.amount;
const node = (c: Ctx, r: NodeRole) => resolveNode(c.journey, r);

function adjust(s: Scene, side: Side, by: number) {
  const key = side === 'b' ? 'besu' : 'zenith';
  if (s.balances) s.balances[key] += by;
  s.delta[key] = `${by > 0 ? '+' : '−'}${Math.abs(by)}`;
}
const payload = (c: Ctx) => `${amt(c)} ZPOC → ${short(c.data.recipient)}`;

const SEND: StepDef[] = [
  {
    id: 'user_send', needs: 'sent', phase: 'send',
    title: (c) => `User submits a transfer. ${amt(c)} ZPOC burned on ${S(c)}.`,
    body: () => 'The IFT contract burns the tokens before anything leaves the chain.',
    active: ['S.ift'], moves: [{ edge: 'S.in', reverse: false }],
    effect: (s, c) => {
      s.hashes[node(c, 'S.ift')] = `send tx ${short(c.data.sentTx)}`;
      adjust(s, c.journey.src, -amt(c));
    },
  },
  {
    id: 'gmp_to_core', needs: 'sent', phase: 'send',
    title: () => 'The GMP application hands the message to IBC Core.',
    body: () => 'General message passing wraps the transfer as a payload for the other chain.',
    active: ['S.gmp'], moves: [{ edge: 'S.ift-gmp', reverse: false }],
  },
  {
    id: 'commit', needs: 'sent', phase: 'send',
    title: () => 'IBC Core writes a packet commitment and routes the packet.',
    body: (c) => `The commitment is a hash stored on ${S(c)}: proof this packet was sent.`,
    active: ['S.core'], moves: [{ edge: 'S.gmp-core', reverse: false }],
    effect: (s, c) => {
      s.slots[c.journey.src] = 'commit';
      s.packet = { mode: 'packet', sequence: c.data.sequence, payload: payload(c) };
      s.hashes[node(c, 'S.core')] = c.data.sequence ? `seq ${c.data.sequence} · commitment written` : 'commitment written';
    },
  },
  {
    id: 'attest_src', needs: null, phase: 'send',
    title: (c) => `The relayer picks up the packet. ${S(c)} attestors sign it.`,
    body: (c) => `Attestors watching ${S(c)} sign that the packet commitment exists.`,
    active: ['S.att', 'relayer'], moves: [{ edge: 'S.core-relayer', reverse: false }], sign: 'S',
  },
  {
    id: 'relay_recv', needs: 'received', phase: 'send',
    title: (c) => `The relayer delivers the packet to IBC Core on ${D(c)}.`,
    body: (c) => `${D(c)}'s light client (tracking ${S(c)}) is updated; Core verifies the packet against the attestors' signatures.`,
    active: ['D.core', 'D.lc'], moves: [{ edge: 'D.core-relayer', reverse: true }], lcTick: 'D',
    effect: (s, c) => {
      s.slots[c.journey.dst] = 'commit';
      s.hashes[node(c, 'D.core')] = `recv tx ${short(c.data.recvTx)}`;
    },
  },
  {
    id: 'route_app', needs: 'received', phase: 'send',
    title: () => 'The verified packet is routed to the application.',
    body: (c) => `IBC Core on ${D(c)} passes the payload to GMP.`,
    active: ['D.gmp'], moves: [{ edge: 'D.gmp-core', reverse: true }],
  },
  {
    id: 'mint', needs: 'received', phase: 'send',
    title: (c) => `${amt(c)} ZPOC minted on ${D(c)}.`,
    body: () => 'The IFT contract mints exactly what was burned on the source chain.',
    active: ['D.ift'], moves: [{ edge: 'D.ift-gmp', reverse: true }],
    effect: (s, c) => {
      s.hashes[node(c, 'D.ift')] = `minted ${amt(c)} ZPOC`;
      adjust(s, c.journey.dst, amt(c));
    },
  },
];

function cantonStep(direction: Direction): StepDef {
  const forward = direction === 'forward';
  return {
    id: 'canton', needs: forward ? 'received' : 'sent', phase: 'send',
    title: () => (forward ? 'Minted on Canton EVM, settled by Canton participants.' : 'The burn on Canton EVM is settled by Canton participants.'),
    body: () => 'Every Canton EVM block is wrapped as a Daml BlockProposal and re-executed by three Canton participants.',
    active: ['canton'], moves: [],
    effect: (s, c) => {
      s.canton = forward
        ? { tx: c.data.recvTx ?? '', update: c.data.cantonUpdate }
        : { tx: c.data.sentTx ?? '' };
    },
  };
}

const ACK: StepDef[] = [
  {
    id: 'ack_app', needs: 'received', phase: 'ack',
    title: () => 'The application returns a result.',
    body: (c) => `GMP on ${D(c)} reports success back to IBC Core.`,
    active: ['D.gmp'], moves: [{ edge: 'D.gmp-core', reverse: false }],
    effect: (s, c) => {
      s.packet = { mode: 'ack', sequence: c.data.sequence, payload: payload(c) };
    },
  },
  {
    id: 'ack_write', needs: 'received', phase: 'ack',
    title: () => 'IBC Core records the acknowledgement.',
    body: (c) => `The ack is committed on ${D(c)}, where attestors can prove it.`,
    active: ['D.core'], moves: [],
    effect: (s, c) => {
      s.slots[c.journey.dst] = 'ack';
    },
  },
  {
    id: 'attest_ack', needs: 'received', phase: 'ack',
    title: (c) => `${D(c)} attestors sign the acknowledgement.`,
    body: (c) => `Attestors watching ${D(c)} sign that the ack was written.`,
    active: ['D.att'], moves: [], sign: 'D',
  },
  {
    id: 'relay_ack', needs: 'received', phase: 'ack',
    title: () => 'The relayer picks up the ack and its proof.',
    body: (c) => `It carries both back toward ${S(c)}.`,
    active: ['relayer'], moves: [{ edge: 'D.core-relayer', reverse: false }],
  },
  {
    id: 'ack_submit', needs: 'acked', phase: 'ack',
    title: (c) => `The relayer submits the ack to IBC Core on ${S(c)}.`,
    body: (c) => `${S(c)}'s light client (tracking ${D(c)}) is updated in the same transaction.`,
    active: ['S.core', 'S.lc'], moves: [{ edge: 'S.core-relayer', reverse: true }], lcTick: 'S',
    effect: (s, c) => {
      s.hashes[node(c, 'S.core')] = `ack tx ${short(c.data.ackTx)}`;
    },
  },
  {
    id: 'ack_verify', needs: 'acked', phase: 'ack',
    title: () => "The ack is verified against the attestors' signatures.",
    body: (c) => `The packet commitment on ${S(c)} is deleted: this packet is done.`,
    active: ['S.core'], moves: [],
    effect: (s, c) => {
      s.slots[c.journey.src] = 'empty';
    },
  },
  {
    id: 'ack_done', needs: 'complete', phase: 'ack',
    title: () => 'The ack reaches the IFT contract. Transfer complete.',
    body: (c) => `${amt(c)} ZPOC left ${S(c)} and arrived on ${D(c)}.`,
    active: ['S.ift'],
    moves: [{ edge: 'S.gmp-core', reverse: true }, { edge: 'S.ift-gmp', reverse: true }],
    effect: (s, c) => {
      s.hashes[node(c, 'S.ift')] = 'transfer complete ✓';
    },
  },
  {
    id: 'outro', needs: null, phase: 'end',
    title: () => 'If something goes wrong, the tokens come back.',
    body: () => 'If the packet errors or times out, that result is relayed back instead and the IFT re-mints the burned tokens to the sender.',
    active: [], moves: [],
  },
];

/** amount defaults to what the recorded runs sent: 10 forward, 2 back. Live sends 10 both ways. */
export function buildJourney(direction: Direction, amount?: number): Journey {
  const forward = direction === 'forward';
  const canton = cantonStep(direction);
  const steps = forward
    ? [...SEND, canton, ...ACK]
    : [SEND[0], canton, ...SEND.slice(1), ...ACK];
  return { direction, src: forward ? 'b' : 'z', dst: forward ? 'z' : 'b', amount: amount ?? (forward ? 10 : 2), steps };
}

export function phaseLabel(j: Journey, phase: StepDef['phase']): string {
  const s = sideName(j.src), d = sideName(j.dst);
  if (phase === 'send') return `${j.direction === 'forward' ? 'Forward' : 'Return'} · ${s} → ${d}`;
  if (phase === 'ack') return `Acknowledgement · ${d} → ${s}`;
  return 'Outcome';
}

export function waitingLabel(j: Journey, need: Need): string {
  const s = sideName(j.src), d = sideName(j.dst);
  switch (need) {
    case 'sent': return `Waiting for the send to land on ${s}…`;
    case 'received': return `Waiting for the relayer to deliver on ${d}…`;
    case 'acked': return `Waiting for the ack to land on ${s}…`;
    case 'complete': return 'Waiting for the relayer to confirm…';
  }
}
