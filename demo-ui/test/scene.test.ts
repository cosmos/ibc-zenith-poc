import { describe, expect, it } from 'vitest';
import { dataFrom } from '../src/engine';
import { buildJourney } from '../src/journeys';
import { sceneAt } from '../src/scene';
import { SCRIPTED } from '../src/sources/scripted';

const fwd = buildJourney('forward');
const ret = buildJourney('return');
const fdata = dataFrom(SCRIPTED.forward);
const rdata = dataFrom(SCRIPTED.return);
const at = (id: string, j = fwd) => j.steps.findIndex((s) => s.id === id);

describe('sceneAt', () => {
  it('ready screen shows starting balances and nothing active', () => {
    const s = sceneAt(fwd, -1, fdata);
    expect(s.active).toEqual([]);
    expect(s.balances).toEqual({ besu: 100, zenith: 0 });
    expect(s.caption.num).toBe('00');
    expect(s.caption.title).toBe('Ready: 10 ZPOC Besu → Canton');
  });

  it('the burn debits Besu and shows the send tx', () => {
    const s = sceneAt(fwd, 0, fdata);
    expect(s.active).toEqual(['b-ift']);
    expect(s.balances).toEqual({ besu: 90, zenith: 0 });
    expect(s.delta.besu).toBe('−10');
    expect(s.hashes['b-ift']).toBe('send tx 0x7287…900e');
    expect(s.current).toEqual([{ edge: 'b-in', reverse: false }]);
    expect(s.caption.num).toBe('01');
  });

  it('relay_recv lights Zenith core and light client after Besu attestors signed', () => {
    const s = sceneAt(fwd, at('relay_recv'), fdata);
    expect(s.active).toEqual(['z-core', 'z-lc']);
    expect(s.done).toEqual(expect.arrayContaining(['b-ift', 'b-gmp', 'b-core', 'b-att', 'relayer']));
    expect(s.signed).toEqual(['b']);
    expect(s.sigEdge).toBeNull();
    expect(s.lcTick).toBe('z');
    expect(s.current).toEqual([{ edge: 'z-core-relayer', reverse: true }]);
    expect(s.traversed).toContainEqual({ edge: 'b-core-relayer', reverse: false });
    expect(s.hashes['z-core']).toBe('recv tx 0xeb04…124c');
    expect(s.packet).toMatchObject({ mode: 'packet', sequence: 1, payload: '10 ZPOC → 0x4a6b…9Fc3' });
    expect(s.delta.besu).toBe('');
  });

  it('attest_src animates the signature edge only during its own step', () => {
    expect(sceneAt(fwd, at('attest_src'), fdata).sigEdge).toBe('b-att-relayer');
  });

  it('the mint credits Zenith; canton shows the recv tx and update', () => {
    expect(sceneAt(fwd, at('mint'), fdata).balances).toEqual({ besu: 90, zenith: 10 });
    const c = sceneAt(fwd, at('canton'), fdata);
    expect(c.canton).toEqual({ tx: fdata.recvTx, update: '12206550d1…552d228d' });
    expect(c.active).toEqual(['canton']);
  });

  it('return journey burns on Zenith and shows canton for the send', () => {
    const s0 = sceneAt(ret, 0, rdata);
    expect(s0.active).toEqual(['z-ift']);
    expect(s0.balances).toEqual({ besu: 90, zenith: 8 });
    const s1 = sceneAt(ret, 1, rdata);
    expect(s1.canton).toEqual({ tx: rdata.sentTx });
    expect(s1.caption.phase).toBe('Return · Canton → Besu');
  });

  it('the ack path clears the source commitment and ends at the source IFT', () => {
    expect(sceneAt(fwd, at('ack_write'), fdata).slots.z).toBe('ack');
    expect(sceneAt(fwd, at('ack_verify'), fdata).slots.b).toBe('empty');
    const done = sceneAt(fwd, at('ack_done'), fdata);
    expect(done.caption.phase).toBe('Acknowledgement · Canton → Besu');
    expect(done.hashes['b-ift']).toBe('transfer complete ✓');
    expect(done.hashes['b-core']).toBe('ack tx 0x15be…9a46');
    expect(done.balances).toEqual({ besu: 90, zenith: 10 });
  });

  it('is pure: the same index gives the same scene regardless of history', () => {
    const a = sceneAt(fwd, 3, fdata);
    sceneAt(fwd, 12, fdata);
    expect(sceneAt(fwd, 3, fdata)).toEqual(a);
  });
});

describe('sceneAt before balances are known', () => {
  it('leaves balances null and still applies steps', () => {
    const s = sceneAt(fwd, 0, { sentTx: '0xabc' });
    expect(s.balances).toBeNull();
    expect(s.delta.besu).toBe('−10');
  });
});
