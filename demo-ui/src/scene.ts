// Derives the full visual state for a step by replaying steps 0..index.
// Pure, so going back is just asking for an earlier index.

import { phaseLabel, resolveEdge, resolveNode, resolveSide, sideName, type Journey } from './journeys';
import type { JourneyData, NodeId, Scene } from './types';

export function sceneAt(journey: Journey, index: number, data: JourneyData): Scene {
  const s: Scene = {
    index,
    total: journey.steps.length,
    active: [],
    done: [],
    hashes: {},
    traversed: [],
    current: [],
    sigEdge: null,
    signed: [],
    lcTick: null,
    slots: { b: 'empty', z: 'empty' },
    balances: data.before ? { ...data.before } : null,
    delta: { besu: '', zenith: '' },
    packet: null,
    canton: null,
    caption: {
      num: '00',
      phase: phaseLabel(journey, 'send'),
      title: `Ready: ${journey.amount} ZPOC ${sideName(journey.src)} → ${sideName(journey.dst)}`,
      body: 'Press space to send the transfer.',
    },
  };
  const ctx = { journey, data };

  for (let i = 0; i <= index && i < journey.steps.length; i++) {
    const step = journey.steps[i];
    // Retire the previous step's transient state.
    for (const n of s.active) if (!s.done.includes(n)) s.done.push(n);
    s.traversed.push(...s.current);
    s.sigEdge = null;
    s.lcTick = null;
    s.delta = { besu: '', zenith: '' };

    s.active = step.active.map((r) => resolveNode(journey, r));
    s.current = step.moves.map((m) => ({ edge: resolveEdge(journey, m.edge), reverse: m.reverse }));
    if (step.sign) {
      const side = resolveSide(journey, step.sign);
      if (!s.signed.includes(side)) s.signed.push(side);
      s.sigEdge = `${side}-att-relayer`;
    }
    if (step.lcTick) s.lcTick = resolveSide(journey, step.lcTick);
    step.effect?.(s, ctx);

    s.caption = {
      num: String(i + 1).padStart(2, '0'),
      phase: phaseLabel(journey, step.phase),
      title: step.title(ctx),
      body: step.body(ctx),
    };
  }
  s.done = s.done.filter((n: NodeId) => !s.active.includes(n));
  return s;
}
