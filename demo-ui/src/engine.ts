// Step state machine. It owns which step is showing and gates each step on
// the checkpoint that makes it true, so a live take can never run ahead of
// the chains.

import type { Journey } from './journeys';
import type { Checkpoint, JourneyData, Need } from './types';

export type EngineChange = 'advance' | 'back' | 'jump' | 'waiting' | 'data';

export function merge(d: JourneyData, cp: Checkpoint): JourneyData {
  switch (cp.kind) {
    case 'meta': return { ...d, recipient: cp.recipient };
    case 'balances': return d.before ? d : { ...d, before: { besu: cp.besu, zenith: cp.zenith } };
    case 'sent': return { ...d, sentTx: cp.txHash };
    case 'sequence': return { ...d, sequence: cp.sequence };
    case 'received': return { ...d, recvTx: cp.txHash };
    case 'canton': return { ...d, cantonUpdate: cp.update };
    case 'acked': return { ...d, ackTx: cp.txHash };
    case 'complete':
      return cp.status === 'COMPLETE_WITH_ACK'
        ? { ...d, status: cp.status }
        : { ...d, status: cp.status, error: `Packet finished with ${cp.status}. The source chain refunds the burned tokens.` };
    case 'error': return { ...d, error: cp.message };
    case 'log': return d;
  }
}

export const dataFrom = (cps: Checkpoint[]) => cps.reduce(merge, {} as JourneyData);

export function satisfied(need: Need, d: JourneyData): boolean {
  switch (need) {
    case 'sent': return !!d.sentTx;
    case 'received': return !!d.recvTx;
    case 'acked': return !!d.ackTx;
    case 'complete': return d.status === 'COMPLETE_WITH_ACK';
  }
}

export class Engine {
  /** -1 is the ready screen before the transfer is sent. */
  index = -1;
  waiting = false;

  constructor(
    readonly journey: Journey,
    public data: JourneyData = {},
    private onChange: (kind: EngineChange) => void = () => {},
  ) {}

  get last() {
    return this.journey.steps.length - 1;
  }

  nextNeed(): Need | null {
    return this.journey.steps[this.index + 1]?.needs ?? null;
  }

  private canEnterNext(): boolean {
    const need = this.nextNeed();
    return need ? satisfied(need, this.data) : true;
  }

  next(): 'advanced' | 'waiting' | 'halted' | 'end' {
    if (this.index >= this.last) return 'end';
    // A failed packet must never go on to show "minted" or "success".
    if (this.data.error) return 'halted';
    if (this.canEnterNext()) {
      this.index++;
      this.waiting = false;
      this.onChange('advance');
      return 'advanced';
    }
    if (!this.waiting) {
      this.waiting = true;
      this.onChange('waiting');
    }
    return 'waiting';
  }

  back() {
    this.index = Math.max(-1, this.index - 1);
    this.waiting = false;
    this.onChange('back');
  }

  /** Show step i directly, without gating. Used for fallback and screenshots. */
  jumpTo(i: number) {
    this.index = Math.max(-1, Math.min(i, this.last));
    this.waiting = false;
    this.onChange('jump');
  }

  receive(cp: Checkpoint) {
    this.data = merge(this.data, cp);
    this.onChange('data');
    if (this.waiting && !this.data.error && this.canEnterNext()) this.next();
  }
}
