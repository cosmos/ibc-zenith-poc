// Packet-token travel and number tweens. A generation counter cancels any
// in-flight animation when the presenter moves on or goes back.

import type { Els } from './diagram';
import type { EdgeRun, Scene } from './types';

const MS_PER_MOVE = 850;
let generation = 0;

export function cancelMoves() {
  generation++;
}

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

function pointOn(path: SVGPathElement, run: EdgeRun, t: number) {
  const len = path.getTotalLength();
  return path.getPointAtLength(len * (run.reverse ? 1 - t : t));
}

function setToken(els: Els, x: number, y: number) {
  els.token.setAttribute('transform', `translate(${x},${y})`);
  els.token.style.opacity = '1';
}

/** Where the token rests after a step: the end of its last move, or of the last edge travelled. */
export function restingRun(scene: Scene): EdgeRun | null {
  return scene.current.at(-1) ?? scene.traversed.at(-1) ?? null;
}

export function placeToken(els: Els, scene: Scene) {
  cancelMoves();
  const run = restingRun(scene);
  if (!run || scene.index < 0) {
    els.token.style.opacity = '0';
    return;
  }
  const p = pointOn(els.edges[run.edge], run, 1);
  setToken(els, p.x, p.y);
}

export async function playMoves(els: Els, scene: Scene) {
  if (scene.current.length === 0) return placeToken(els, scene);
  const mine = ++generation;
  for (const run of scene.current) {
    const path = els.edges[run.edge];
    await new Promise<void>((done) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (mine !== generation) return done();
        const p = Math.min(1, (now - t0) / MS_PER_MOVE);
        const pt = pointOn(path, run, ease(p));
        setToken(els, pt.x, pt.y);
        if (p < 1) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    if (mine !== generation) return;
  }
}

export function tweenNumber(el: HTMLElement, from: number, to: number, fmt: (n: number) => string, ms = 700) {
  const gen = String(Number(el.dataset.gen ?? 0) + 1);
  el.dataset.gen = gen;
  const t0 = performance.now();
  const tick = (now: number) => {
    if (el.dataset.gen !== gen) return;
    const p = Math.min(1, (now - t0) / ms);
    const v = from + (to - from) * ease(p);
    el.textContent = fmt(Number.isInteger(from) && Number.isInteger(to) ? Math.round(v) : v);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = fmt(to);
  };
  requestAnimationFrame(tick);
}
