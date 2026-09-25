import { describe, expect, it } from 'vitest';
import { parseJson } from '../server/ibc.mjs';
import { packetCheckpoints, runTransfer, toTokens } from '../server/transfer.mjs';

describe('parseJson', () => {
  it('finds the JSON inside noisy CLI output', () => {
    expect(parseJson('WARNING: something\n{\n "txHash": "0xabc"\n}\n')).toEqual({ txHash: '0xabc' });
  });
  it('throws with the output when there is no JSON (the env.sh wrapper always exits 0)', () => {
    expect(() => parseJson('Error: insufficient funds\nUsage:\n  ibc tx ...')).toThrow(/^ibc: insufficient funds$/);
  });
});

describe('toTokens', () => {
  it('converts 18-decimal strings', () => {
    expect(toTokens('182000000000000000000')).toBe(182);
    expect(toTokens('1500000000000000000')).toBe(1.5);
  });
});

const pending = { state: 'PACKET_STATE_PENDING', sequenceNumber: '4', recvTx: null, ackTx: null, timeoutTx: null };
const received = { ...pending, recvTx: { txHash: '0xrecv' } };
const done = { ...received, state: 'PACKET_STATE_SUCCEEDED', ackTx: { txHash: '0xack' } };

describe('packetCheckpoints', () => {
  it('emits only what changed since the last poll', () => {
    expect(packetCheckpoints(null, pending)).toEqual([{ kind: 'sequence', sequence: 4 }]);
    expect(packetCheckpoints(pending, pending)).toEqual([]);
    expect(packetCheckpoints(pending, received)).toEqual([{ kind: 'received', txHash: '0xrecv' }]);
  });
  it('emits ack before completion when both land in one poll', () => {
    expect(packetCheckpoints(pending, done)).toEqual([
      { kind: 'received', txHash: '0xrecv' },
      { kind: 'acked', txHash: '0xack' },
      { kind: 'complete', status: 'COMPLETE_WITH_ACK' },
    ]);
  });
  it('reports any other terminal state as-is', () => {
    const timedOut = { ...pending, state: 'PACKET_STATE_TIMED_OUT', timeoutTx: { txHash: '0xt' } };
    expect(packetCheckpoints(pending, timedOut)).toEqual([{ kind: 'complete', status: 'PACKET_STATE_TIMED_OUT' }]);
  });
});

function fakeIbc(packetResponses) {
  const calls = [];
  const queue = [...packetResponses];
  const ibcJson = async (args) => {
    calls.push(args);
    const [a, b] = args;
    if (a === 'keys') return { evmAddress: '0xme' };
    if (a === 'deploy') return { tokens: [{ address: `0xift${args[2]}` }] };
    if (a === 'query') return { balance: args[4] === '41003' ? '100000000000000000000' : '0' };
    if (a === 'tx') return { txHash: '0xsend' };
    if (a === 'relayer' && b === 'packets') return queue.length > 1 ? queue.shift() : queue[0];
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const ibcRaw = async (args) => { calls.push(args); return 'ok'; };
  return { ibcJson, ibcRaw, calls };
}

describe('runTransfer', () => {
  it('forward: emits the whole journey in order', async () => {
    const { ibcJson, ibcRaw, calls } = fakeIbc([{ packets: [] }, { packets: [pending] }, { packets: [received] }, { packets: [done] }]);
    const events = [];
    await runTransfer('forward', { ibcJson, ibcRaw, emit: (e) => events.push(e), sleep: async () => {} });
    expect(events.filter((e) => e.kind !== 'log').map((e) => e.kind))
      .toEqual(['meta', 'balances', 'sent', 'sequence', 'received', 'acked', 'complete']);
    expect(events.filter((e) => e.kind === 'log').map((e) => e.text)).toEqual([
      'balances · Besu 100 · Zenith 0 ZPOC',
      '$ ibc tx ift send --chain 41003 --amount 10 ZPOC',
      'send tx 0xsend…send landed on 41003',
    ]);
    expect(events[1]).toEqual({ kind: 'balances', besu: 100, zenith: 0 });
    const send = calls.find((c) => c[0] === 'tx');
    expect(send).toEqual(expect.arrayContaining(['--chain', '41003', '--amount', '10000000000000000000', '--client-id', 'link-41003-936485']));
    expect(calls.some((c) => c[0] === 'relayer' && c[1] === 'relay')).toBe(false);
  });

  it('return: sends 10 ZPOC on Zenith and triggers the relay by hand', async () => {
    const { ibcJson, ibcRaw, calls } = fakeIbc([{ packets: [done] }]);
    await runTransfer('return', { ibcJson, ibcRaw, emit: () => {}, sleep: async () => {} });
    expect(calls.find((c) => c[0] === 'tx')).toEqual(expect.arrayContaining(['--chain', '936485', '--amount', '10000000000000000000']));
    expect(calls).toContainEqual(['relayer', 'relay', '--chain-id', '936485', '--tx-hash', '0xsend']);
  });

  it('rejects a send with no tx hash', async () => {
    const { ibcRaw } = fakeIbc([]);
    const ibcJson = async (args) => (args[0] === 'tx' ? { error: 'nope' } : args[0] === 'deploy' ? { tokens: [{ address: '0x1' }] } : args[0] === 'keys' ? { evmAddress: '0xme' } : { balance: '0' });
    await expect(runTransfer('forward', { ibcJson, ibcRaw, emit: () => {}, sleep: async () => {} })).rejects.toThrow(/tx hash/);
  });

  it('gives up with an error when the packet never finishes', async () => {
    const { ibcJson, ibcRaw } = fakeIbc([{ packets: [pending] }]);
    await expect(runTransfer('forward', { ibcJson, ibcRaw, emit: () => {}, sleep: async () => {}, pollMs: 1, timeoutMs: 5 }))
      .rejects.toThrow(/did not finish/);
  });
});

describe('runTransfer resilience', () => {
  it('retries a failed poll instead of ending the run', async () => {
    const { ibcJson: base, ibcRaw } = fakeIbc([{ packets: [done] }]);
    let failed = 0;
    const ibcJson = async (args) => {
      if (args[1] === 'packets' && failed < 2) { failed++; throw new Error('database is locked'); }
      return base(args);
    };
    const events = [];
    await runTransfer('forward', { ibcJson, ibcRaw, emit: (e) => events.push(e), sleep: async () => {} });
    expect(events.at(-1)).toEqual({ kind: 'complete', status: 'COMPLETE_WITH_ACK' });
    expect(events.filter((e) => e.kind === 'log' && e.text.startsWith('packet query failed'))).toHaveLength(2);
  });

  it('gives up after repeated poll failures', async () => {
    const { ibcJson: base, ibcRaw } = fakeIbc([]);
    const ibcJson = async (args) => { if (args[1] === 'packets') throw new Error('database is locked'); return base(args); };
    await expect(runTransfer('forward', { ibcJson, ibcRaw, emit: () => {}, sleep: async () => {} })).rejects.toThrow(/locked/);
  });

  it('return: reports a failed relay request instead of waiting out the timeout', async () => {
    const { ibcJson } = fakeIbc([{ packets: [pending] }]);
    const ibcRaw = async () => 'Error: packet not found in tx\nUsage: ...';
    await expect(runTransfer('return', { ibcJson, ibcRaw, emit: () => {}, sleep: async () => {} })).rejects.toThrow(/relay request failed/);
  });
});
