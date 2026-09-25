// Live-mode server: serves the built UI, runs one transfer at a time against
// the PoC, and streams its checkpoints over Server-Sent Events.
//
//   npm run build && npm run live      →  http://localhost:3200/?live

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, ibcJson, ibcRaw } from './ibc.mjs';
import { formatRelayerLine, tailFile } from './relayerlog.mjs';
import { CHAIN, runTransfer } from './transfer.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const RPC = { '41003': 'http://localhost:8945', '936485': 'https://rpc.testnet.zenith.network' };

async function rpc(url, method, params = []) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  return (await r.json()).result;
}

async function checkHealth() {
  const ok = async (f) => { try { return await f(); } catch { return false; } };
  const besu = await ok(async () => typeof (await rpc(RPC['41003'], 'eth_blockNumber')) === 'string');
  // Same check as `make status`: the relayer serves no /health route.
  const relayer = await ok(() => new Promise((resolve) => {
    execFile('bash', ['scripts/relayer.sh', 'status'], { cwd: REPO }, (_err, stdout) => resolve(stdout.includes('relayer running')));
  }));
  // The CLI's deployment records can outlive the contracts (Zenith testnet
  // resets), so check for code on chain, not just a recorded address.
  const hasIft = (chain) => ok(async () => {
    const addr = (await ibcJson(['deploy', 'show', chain])).tokens?.[0]?.address;
    return !!addr && (await rpc(RPC[chain], 'eth_getCode', [addr, 'latest'])) !== '0x';
  });
  const deployedBesu = await hasIft('41003');
  const deployedZenith = await hasIft('936485');
  const deployed = deployedBesu && deployedZenith;
  return { ok: besu && relayer && deployed, besu, relayer, deployed, deployedBesu, deployedZenith };
}

export function createServer({
  transfer = (direction, { emit }) => runTransfer(direction, { ibcJson, ibcRaw, emit }),
  health = checkHealth,
  dist = path.join(REPO, 'demo-ui/dist'),
  tail = (onLine) => tailFile(path.join(REPO, 'logs/relayer.log'), onLine),
  tailGraceMs = 5000,
} = {}) {
  let run = null; // { runId, events, running }
  const clients = new Set();

  const emit = (runId, checkpoint) => {
    if (run?.runId !== runId) return;
    const ev = { runId, checkpoint };
    run.events.push(ev);
    for (const res of clients) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST' && url.pathname === '/api/transfer') {
      // Check and take the lock with no await in between: two POSTs at once
      // must never mean two burns.
      if (run?.running) {
        return json(res, 409, { error: 'A transfer is already running.', runId: run.runId, direction: run.direction });
      }
      const claim = { runId: `${Date.now()}`, direction: null, events: [], running: true };
      const previous = run;
      run = claim;
      let direction;
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        direction = JSON.parse(body || '{}').direction;
      } catch { /* fall through to the 400 */ }
      if (direction !== 'forward' && direction !== 'return') {
        run = previous;
        return json(res, 400, { error: 'direction must be "forward" or "return"' });
      }
      claim.direction = direction;
      json(res, 202, { runId: claim.runId });
      const ctx = direction === 'forward' ? { src: CHAIN.besu, dst: CHAIN.zenith } : { src: CHAIN.zenith, dst: CHAIN.besu };
      const stopTail = tail((line) => {
        const f = formatRelayerLine(line, ctx);
        if (f) emit(claim.runId, { kind: 'log', at: f.at ?? new Date().toISOString(), source: 'relayer', text: f.text });
      });
      Promise.resolve()
        .then(() => transfer(direction, { emit: (cp) => emit(claim.runId, cp) }))
        .catch((err) => {
          emit(claim.runId, { kind: 'log', at: new Date().toISOString(), source: 'ui', text: `error: ${err.message}` });
          emit(claim.runId, { kind: 'error', message: err.message });
        })
        .finally(() => {
          claim.running = false;
          setTimeout(stopTail, tailGraceMs); // the relayer logs "Transfer complete" just after the ack
        });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      for (const ev of run?.events ?? []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, await health());

    // Static files from dist/.
    const rel = decodeURIComponent(url.pathname) === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const file = path.resolve(dist, rel);
    if (!file.startsWith(path.resolve(dist) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  };

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) json(res, 400, { error: err.message });
      else res.end();
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3200);
  createServer().listen(port, () => console.log(`demo-ui live server: http://localhost:${port}/?live`));
}
