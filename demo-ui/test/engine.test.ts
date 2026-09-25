import { describe, expect, it } from 'vitest';
import { Engine, dataFrom, type EngineChange } from '../src/engine';
import { buildJourney } from '../src/journeys';
import { SCRIPTED } from '../src/sources/scripted';

const fwd = () => buildJourney('forward');
const RELAY_RECV = 4; // index of relay_recv in the forward journey

function engineWith(changes: EngineChange[] = []) {
  return new Engine(fwd(), {}, (k) => changes.push(k));
}

describe('Engine', () => {
  it('starts at the ready index', () => {
    expect(engineWith().index).toBe(-1);
  });

  it('waits before entering a step whose checkpoint has not arrived', () => {
    const e = engineWith();
    expect(e.next()).toBe('waiting');
    expect(e.index).toBe(-1);
    expect(e.waiting).toBe(true);
    expect(e.nextNeed()).toBe('sent');
  });

  it('advances exactly once when the awaited checkpoint arrives, however often next was pressed', () => {
    const changes: EngineChange[] = [];
    const e = engineWith(changes);
    e.next(); e.next(); e.next();
    e.receive({ kind: 'sent', txHash: '0xabc' });
    expect(e.index).toBe(0);
    expect(e.waiting).toBe(false);
    expect(changes.filter((c) => c === 'advance')).toHaveLength(1);
  });

  it('moves freely through steps whose data is already present', () => {
    const e = engineWith();
    e.receive({ kind: 'sent', txHash: '0xabc' });
    for (let i = 0; i < 4; i++) expect(e.next()).toBe('advanced');
    expect(e.index).toBe(3);
    expect(e.next()).toBe('waiting'); // relay_recv needs `received`
  });

  it('never passes the receive step when the packet times out', () => {
    const e = engineWith();
    e.receive({ kind: 'sent', txHash: '0xabc' });
    for (let i = 0; i < 5; i++) e.next();
    expect(e.index).toBe(RELAY_RECV - 1);
    e.receive({ kind: 'complete', status: 'COMPLETE_WITH_TIMEOUT' });
    expect(e.index).toBe(RELAY_RECV - 1);
    expect(e.waiting).toBe(true);
    expect(e.data.error).toMatch(/COMPLETE_WITH_TIMEOUT/);
  });

  it('back steps to the previous index and stops waiting', () => {
    const e = engineWith();
    e.receive({ kind: 'sent', txHash: '0xabc' });
    e.next(); e.next();
    e.back();
    expect(e.index).toBe(0);
    e.back(); e.back();
    expect(e.index).toBe(-1);
    expect(e.waiting).toBe(false);
  });

  it('stops at the last step', () => {
    const e = new Engine(fwd(), dataFrom(SCRIPTED.forward));
    for (let i = 0; i < 20; i++) e.next();
    expect(e.index).toBe(15);
    expect(e.next()).toBe('end');
  });

  it('jumpTo clamps to the journey', () => {
    const e = new Engine(fwd(), dataFrom(SCRIPTED.forward));
    e.jumpTo(99);
    expect(e.index).toBe(15);
    e.jumpTo(-5);
    expect(e.index).toBe(-1);
  });
});

describe('dataFrom', () => {
  it('keeps the first balances as the starting point', () => {
    const d = dataFrom([
      { kind: 'balances', besu: 100, zenith: 0 },
      { kind: 'balances', besu: 90, zenith: 10 },
    ]);
    expect(d.before).toEqual({ besu: 100, zenith: 0 });
  });

  it('folds a full scripted run', () => {
    const d = dataFrom(SCRIPTED.forward);
    expect(d).toMatchObject({ sequence: 1, status: 'COMPLETE_WITH_ACK' });
    expect(d.error).toBeUndefined();
  });
});

describe('Engine after an error', () => {
  it('halts even when the data for later steps has arrived', () => {
    const e = new Engine(buildJourney('forward'));
    // A failed ack: delivered, acked, but the packet did not succeed.
    e.receive({ kind: 'sent', txHash: '0xs' });
    e.receive({ kind: 'received', txHash: '0xr' });
    e.receive({ kind: 'acked', txHash: '0xa' });
    e.receive({ kind: 'complete', status: 'PACKET_STATE_FAILED' });
    for (let i = 0; i < 4; i++) e.next();
    expect(e.index).toBe(-1);
    expect(e.next()).toBe('halted');
  });

  it('does not auto-advance a waiting step when an error arrives with it', () => {
    const e = new Engine(buildJourney('forward'));
    e.next();
    e.receive({ kind: 'error', message: 'boom' });
    e.receive({ kind: 'sent', txHash: '0xs' });
    expect(e.index).toBe(-1);
  });
});

describe('log checkpoints', () => {
  it('never change journey data', () => {
    const d = dataFrom([{ kind: 'sent', txHash: '0x1' }, { kind: 'log', at: 'x', source: 'relayer', text: 'hi' }]);
    expect(d).toEqual({ sentTx: '0x1' });
  });
});
