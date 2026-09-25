// Live checkpoints from demo-ui/server: start a transfer, then follow its
// events over SSE. The server replays the run on connect, so nothing emitted
// before the stream opens is lost.

import type { Checkpoint, Source } from '../types';

export interface Health {
  ok: boolean;
  besu: boolean;
  relayer: boolean;
  deployed: boolean;
  deployedBesu?: boolean;
  deployedZenith?: boolean;
}

export async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch('/api/health');
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

export function healthProblem(h: Health | null): string | null {
  if (!h) return 'Live server not reachable. Run `make ui-live`, or press S for scripted.';
  if (h.deployedBesu && h.deployedZenith === false) {
    return 'IBC contracts are missing on Zenith (testnet reset?). Redeploy: make clean && make up && make demo.';
  }
  const missing = [!h.besu && 'Besu not answering', !h.relayer && 'relayer not running', !h.deployed && 'IBC not deployed']
    .filter(Boolean);
  return missing.length ? `${missing.join(' · ')}. Run \`make up && make demo\` first.` : null;
}

export function liveSource(): Source {
  let es: EventSource | null = null;
  let generation = 0;

  const close = () => {
    es?.close();
    es = null;
  };

  return {
    async start(direction, emit) {
      close();
      const mine = ++generation;
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      const body = await res.json().catch(() => ({}));
      if (mine !== generation) return; // stopped or restarted while the POST was in flight
      // After R during a live take the previous run is still going: follow it
      // rather than failing, as long as it is the same journey.
      const attach = res.status === 409 && body.direction === direction;
      if (!res.ok && !attach) throw new Error(body.error ?? `server answered ${res.status}`);
      const runId: string = body.runId;

      let failures = 0;
      es = new EventSource('/api/events');
      es.onopen = () => (failures = 0);
      es.onmessage = (m) => {
        failures = 0;
        const ev = JSON.parse(m.data) as { runId: string; checkpoint: Checkpoint };
        if (ev.runId === runId) emit(ev.checkpoint);
      };
      es.onerror = () => {
        if (++failures === 3 || es?.readyState === EventSource.CLOSED) {
          emit({ kind: 'error', message: 'Lost connection to the live server.' });
        }
      };
    },
    stop() {
      generation++;
      close();
    },
  };
}
