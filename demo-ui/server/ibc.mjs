// Runs the PoC's `ibc` CLI exactly as the scripts do: through scripts/env.sh,
// which pins --home ~/.ibc-zpoc and filters the arm64 warning.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The env.sh wrapper always exits 0, so failures show up as output without JSON. */
export function parseJson(out) {
  const a = out.indexOf('{');
  const b = out.lastIndexOf('}');
  if (a < 0 || b < a) {
    const first = out.split('\n').map((l) => l.trim()).find(Boolean) ?? '(no output)';
    throw new Error(first.replace(/^Error:\s*/, 'ibc: '));
  }
  return JSON.parse(out.slice(a, b + 1));
}

/** Resolves with combined output. Rejects only if bash itself fails: the env.sh
 *  wrapper swallows the CLI's exit code, so callers must inspect the output. */
export function ibcRaw(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('bash', ['-c', 'source scripts/env.sh && ibc "$@"', 'ibc', ...args], { cwd: REPO });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`ibc ${args.join(' ')} exited ${code}: ${out.trim().slice(0, 300)}`))));
  });
}

export const ibcJson = async (args) => parseJson(await ibcRaw(args));
