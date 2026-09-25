// Tails logs/relayer.log during a live run and turns the lines worth showing
// on camera into short, readable log entries.

import fs from 'node:fs';

const short = (h) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '…');

export function parseLogfmt(line) {
  const out = {};
  for (const m of line.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
    const v = m[2];
    if (!(m[1] in out)) out[m[1]] = v.startsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v;
  }
  return out;
}

/** { at, text } for a line worth showing, else null. ctx names the run's source and destination chain ids. */
export function formatRelayerLine(line, { src, dst }) {
  const f = parseLogfmt(line);
  const at = f.time;
  switch (f.msg) {
    case 'Creating pipeline':
      return { at, text: `creating pipeline ${f.sourceChainID} → ${f.destinationChainID}` };
    case 'Submitted tx': {
      const kind = f.chainID === dst ? 'recv' : f.chainID === src ? 'ack' : '';
      return { at, text: `submitted ${kind ? `${kind} ` : ''}tx ${short(f.txHash)} on ${f.chainID}` };
    }
    case 'Transfer complete':
      return { at, text: `transfer complete · seq ${f.sequence} · ${(f.status ?? '').replace(/^COMPLETE_WITH_/, '').toLowerCase()}` };
    case 'Relay':
      return { at, text: `relay requested for ${short(f.txHash)}` };
  }
  if (f.level === 'WARN' || f.level === 'ERROR') {
    return { at, text: `${f.level.toLowerCase()}: ${f.msg}${f.err ? ` (${f.err})` : ''}` };
  }
  return null;
}

/** Calls onLine for each complete line appended after now. Returns stop(). */
export function tailFile(file, onLine, intervalMs = 500) {
  let offset;
  try { offset = fs.statSync(file).size; } catch { offset = 0; }
  let partial = '';
  const timer = setInterval(() => {
    let size;
    try { size = fs.statSync(file).size; } catch { return; }
    if (size < offset) { offset = 0; partial = ''; } // log was truncated (relayer restarted)
    if (size === offset) return;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    const lines = (partial + buf.toString('utf8')).split('\n');
    partial = lines.pop();
    lines.filter(Boolean).forEach(onLine);
  }, intervalMs);
  return () => clearInterval(timer);
}
