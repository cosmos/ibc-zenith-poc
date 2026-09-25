import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.mjs';

let server;
afterEach(() => server?.close());

async function start(opts) {
  server = createServer({ health: async () => ({ ok: true, besu: true, relayer: true, deployed: true }), tail: () => () => {}, ...opts });
  await new Promise((r) => server.listen(0, r));
  return `http://127.0.0.1:${server.address().port}`;
}

const post = (base, body) => fetch(`${base}/api/transfer`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

/** Read SSE data lines until `n` events arrive. */
async function readEvents(base, n) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events = [];
  while (events.length < n) {
    const { value } = await reader.read();
    buf += dec.decode(value);
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
    }
  }
  ctrl.abort();
  return events;
}

describe('server', () => {
  it('starts one transfer and refuses a second while it runs', async () => {
    let finish;
    const base = await start({ transfer: (_d, { emit }) => new Promise((r) => { emit({ kind: 'sent', txHash: '0x1' }); finish = r; }) });
    const first = await post(base, { direction: 'forward' });
    expect(first.status).toBe(202);
    const second = await post(base, { direction: 'forward' });
    expect(second.status).toBe(409);
    finish();
    await new Promise((r) => setTimeout(r, 10));
    expect((await post(base, { direction: 'return' })).status).toBe(202);
  });

  it('rejects an unknown direction', async () => {
    const base = await start({ transfer: async () => {} });
    expect((await post(base, { direction: 'sideways' })).status).toBe(400);
  });

  it('replays the current run to a late subscriber, tagged with its run id', async () => {
    const base = await start({ transfer: async (_d, { emit }) => { emit({ kind: 'sent', txHash: '0x1' }); emit({ kind: 'sequence', sequence: 7 }); } });
    const { runId } = await (await post(base, { direction: 'forward' })).json();
    const events = await readEvents(base, 2);
    expect(events).toEqual([
      { runId, checkpoint: { kind: 'sent', txHash: '0x1' } },
      { runId, checkpoint: { kind: 'sequence', sequence: 7 } },
    ]);
  });

  it('turns a failed transfer into an error checkpoint', async () => {
    const base = await start({ transfer: async () => { throw new Error('boom'); } });
    await post(base, { direction: 'forward' });
    const events = await readEvents(base, 2);
    expect(events.map((e) => e.checkpoint.kind)).toEqual(['log', 'error']);
    expect(events[1].checkpoint).toEqual({ kind: 'error', message: 'boom' });
  });

  it('serves health and the built page, and refuses paths outside dist', async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<h1>ui</h1>');
    const base = await start({ transfer: async () => {}, dist });
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true });
    expect(await (await fetch(`${base}/`)).text()).toBe('<h1>ui</h1>');
    expect((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status).toBe(404);
  });
});

describe('server hardening', () => {
  it('two simultaneous POSTs start exactly one transfer', async () => {
    let calls = 0;
    const base = await start({ transfer: () => { calls++; return new Promise(() => {}); } });
    const [a, b] = await Promise.all([post(base, { direction: 'forward' }), post(base, { direction: 'forward' })]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);
  });

  it('409 names the running run so a restarted page can reattach', async () => {
    const base = await start({ transfer: () => new Promise(() => {}) });
    const { runId } = await (await post(base, { direction: 'return' })).json();
    const again = await post(base, { direction: 'return' });
    expect(await again.json()).toMatchObject({ runId, direction: 'return' });
  });

  it('survives a malformed path', async () => {
    const base = await start({ transfer: async () => {} });
    expect((await fetch(`${base}/%`)).status).toBe(400);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
});

describe('health message', () => {
  it('names a Zenith reset specifically', async () => {
    const { healthProblem } = await import('../src/sources/live.ts');
    expect(healthProblem({ ok: false, besu: true, relayer: true, deployed: false, deployedBesu: true, deployedZenith: false }))
      .toMatch(/missing on Zenith/);
    expect(healthProblem({ ok: true, besu: true, relayer: true, deployed: true, deployedBesu: true, deployedZenith: true })).toBeNull();
  });
});

describe('live log', () => {
  it('streams formatted relayer lines during a run and drops noise', async () => {
    let feed;
    const base = await start({
      transfer: () => new Promise(() => {}),
      tail: (onLine) => { feed = onLine; return () => {}; },
    });
    const { runId } = await (await post(base, { direction: 'forward' })).json();
    feed('time=2026-09-24T15:31:37.241Z level=INFO msg=Packets handler=relayer limit=0 cursor=""');
    feed('time=2026-09-24T15:27:48.269Z level=INFO msg="Submitted tx" module=txsubmitter chainID=936485 txHash=0x54887c663565131f4b3046dadb6440f526edb781db1b20061f8a8038e147f1f2');
    const [ev] = await readEvents(base, 1);
    expect(ev).toEqual({ runId, checkpoint: { kind: 'log', at: '2026-09-24T15:27:48.269Z', source: 'relayer', text: 'submitted recv tx 0x5488…f1f2 on 936485' } });
  });
});
