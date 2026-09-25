// Shared types. `b` is Besu, `z` is Zenith (shown on screen as Canton EVM).

export type Side = 'b' | 'z';
export type Direction = 'forward' | 'return';

/** What a step waits for before it can be shown. */
export type Need = 'sent' | 'received' | 'acked' | 'complete';

/** Events from a data source (scripted table or live server). */
export type Checkpoint =
  | { kind: 'meta'; recipient: string }
  | { kind: 'balances'; besu: number; zenith: number }
  | { kind: 'sent'; txHash: string }
  | { kind: 'sequence'; sequence: number }
  | { kind: 'received'; txHash: string }
  | { kind: 'canton'; update: string }
  | { kind: 'acked'; txHash: string }
  | { kind: 'complete'; status: string }
  | { kind: 'error'; message: string }
  /** Live mode only: a line for the log panel. Never affects the steps. */
  | { kind: 'log'; at: string; source: 'ui' | 'relayer'; text: string };

/** Everything known about the transfer so far, folded from checkpoints. */
export interface JourneyData {
  recipient?: string;
  before?: { besu: number; zenith: number };
  sentTx?: string;
  sequence?: number;
  recvTx?: string;
  cantonUpdate?: string;
  ackTx?: string;
  status?: string;
  error?: string;
}

export type Part = 'ift' | 'gmp' | 'core' | 'lc' | 'att';
export type EdgePart = 'in' | 'ift-gmp' | 'gmp-core' | 'core-lc' | 'core-relayer' | 'att-relayer';
export type NodeId = `${Side}-${Part}` | 'relayer' | 'canton';
export type EdgeId = `${Side}-${EdgePart}`;

/** An edge travelled in its drawn direction, or backwards. */
export interface EdgeRun {
  edge: EdgeId;
  reverse: boolean;
}

export type SlotState = 'empty' | 'commit' | 'ack';

export interface PacketCard {
  mode: 'packet' | 'ack';
  sequence?: number;
  payload: string;
}

/** The full visual state of the diagram at one step. */
export interface Scene {
  index: number;
  total: number;
  active: NodeId[];
  done: NodeId[];
  hashes: Partial<Record<NodeId, string>>;
  traversed: EdgeRun[];
  current: EdgeRun[];
  sigEdge: EdgeId | null;
  signed: Side[];
  lcTick: Side | null;
  slots: Record<Side, SlotState>;
  /** Null until the starting balances are known (live mode, before the send). */
  balances: { besu: number; zenith: number } | null;
  delta: { besu: string; zenith: string };
  packet: PacketCard | null;
  canton: { tx: string; update?: string } | null;
  caption: { num: string; phase: string; title: string; body: string };
}

export interface Source {
  start(direction: Direction, emit: (cp: Checkpoint) => void): Promise<void>;
  stop(): void;
}
