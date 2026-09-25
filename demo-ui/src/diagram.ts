// Builds the SVG diagram (geometry from the approved mockup) and applies a
// Scene to it. No animation here beyond CSS transitions; see animate.ts.

import { CLIENT_ID, short } from './journeys';
import { tweenNumber } from './animate';
import type { EdgeId, NodeId, PacketCard, Scene, Side } from './types';

const SIDES: Side[] = ['b', 'z'];
const BOX_X: Record<Side, number> = { b: 100, z: 1420 };
const ATT_CX: Record<Side, number> = { b: 720, z: 1200 };
const ROWS = {
  ift: { y: 180, h: 108, title: 'IFT token contract', sub: () => 'ZPOC · Interchain Fungible Token' },
  gmp: { y: 324, h: 108, title: 'GMP application', sub: () => 'general message passing' },
  core: { y: 468, h: 124, title: 'IBC Core router', sub: () => 'ICS26 · commitments + routing' },
  lc: { y: 628, h: 116, title: 'Attestation light client', sub: (s: Side) => `tracking ${s === 'b' ? 'Canton' : 'Besu'}` },
} as const;

export const EDGE_PATHS: Record<EdgeId, string> = {
  'b-in': 'M300,140 L300,176',
  'z-in': 'M1620,140 L1620,176',
  'b-ift-gmp': 'M300,288 L300,322',
  'z-ift-gmp': 'M1620,288 L1620,322',
  'b-gmp-core': 'M300,432 L300,466',
  'z-gmp-core': 'M1620,432 L1620,466',
  'b-core-lc': 'M300,592 L300,626',
  'z-core-lc': 'M1620,592 L1620,626',
  'b-core-relayer': 'M500,530 L872,530',
  'z-core-relayer': 'M1420,530 L1048,530',
  'b-att-relayer': 'M752,650 C800,640 850,625 900,598',
  'z-att-relayer': 'M1168,650 C1120,640 1070,625 1020,598',
};

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function boxSvg(side: Side, part: keyof typeof ROWS): string {
  const r = ROWS[part], x = BOX_X[side], id = `${side}-${part}`;
  const slot = part === 'core'
    ? `<rect x="${x + 324}" y="${r.y + 56}" width="46" height="46" rx="9" class="commit-slot empty" data-slot="${side}"/>`
    : '';
  const tick = part === 'lc'
    ? `<text x="${x + 26}" y="${r.y + r.h - 18}" class="lc-tick mono" data-lctick="${side}">▲ updated</text>`
    : `<text x="${x + 26}" y="${r.y + r.h - 18}" class="hash mono" data-hash="${id}"></text>`;
  return `<g class="box" data-node="${id}">
    <rect class="box-bg" x="${x}" y="${r.y}" width="400" height="${r.h}" rx="14"/>
    <text x="${x + 26}" y="${r.y + 42}" class="title">${r.title}</text>
    <text x="${x + 26}" y="${r.y + 68}" class="sub">${r.sub(side)}</text>${tick}${slot}</g>`;
}

function chainSvg(side: Side): string {
  const x = BOX_X[side] - 40;
  return `<g class="side-${side}">
    <rect x="${x}" y="156" width="480" height="616" rx="22" class="chain-bound"/>
    ${(['ift', 'gmp', 'core', 'lc'] as const).map((p) => boxSvg(side, p)).join('')}
  </g>`;
}

function attestorsSvg(side: Side): string {
  const cx = ATT_CX[side];
  const pts = [[cx - 46, 690], [cx + 46, 670], [cx + 4, 762]];
  const diamonds = pts.map(([x, y], i) =>
    `<g class="attestor a${i + 1}" transform="translate(${x},${y})">
      <rect class="diamond" x="-34" y="-34" width="68" height="68" rx="10" transform="rotate(45)"/>
      <text class="check" x="0" y="7" text-anchor="middle">✓</text></g>`).join('');
  return `<g class="attestors side-${side}" data-node="${side}-att">${diamonds}
    <text x="${cx}" y="848" text-anchor="middle" class="att-title">Attestor set</text>
    <text x="${cx}" y="870" text-anchor="middle" class="att-sub">watching ${side === 'b' ? 'Besu' : 'Canton'}</text></g>`;
}

const marker = (id: string, cls: string) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="${cls}"/></marker>`;
const glow = (id: string, color: string, sd = 10, op = 0.45) =>
  `<filter id="${id}" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="${sd}" flood-color="${color}" flood-opacity="${op}"/></filter>`;

function svg(): string {
  return `<svg width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    ${glow('glow-b', '#ff9f43')}${glow('glow-z', '#34e0c4')}${glow('glow-packet', '#a48bff', 8, 0.8)}
    ${marker('arrow', 'm-base')}${marker('arrow-lit', 'm-lit')}${marker('arrow-sig-b', 'm-sig-b')}${marker('arrow-sig-z', 'm-sig-z')}
  </defs>
  ${chainSvg('b')}${chainSvg('z')}
  ${(Object.keys(EDGE_PATHS) as EdgeId[]).map((id) =>
    `<path class="edge${id.endsWith('core-lc') || id.endsWith('att-relayer') ? ' dashed' : ''}" data-edge="${id}" d="${EDGE_PATHS[id]}"/>`).join('')}
  <path class="edge dashed canton-link" d="M1620,772 L1620,800"/>
  ${attestorsSvg('b')}${attestorsSvg('z')}
  <g class="relayer" data-node="relayer" transform="translate(960,530)">
    <rect class="diamond" x="-80" y="-80" width="160" height="160" rx="22" transform="rotate(45)"/>
    <text x="0" y="-4" text-anchor="middle" class="relayer-title">Relayer</text>
    <text x="0" y="22" text-anchor="middle" class="relayer-sub mono">ibc relayer</text>
  </g>
  <g class="token" style="opacity:0"><rect class="token-outer" x="-13" y="-13" width="26" height="26" rx="7"/><rect class="token-inner" x="-5" y="-5" width="10" height="10" rx="3"/></g>
</svg>`;
}

export interface Els {
  stage: HTMLElement;
  nodes: Map<NodeId, Element>;
  hashes: Map<NodeId, Element>;
  edges: Record<EdgeId, SVGPathElement>;
  slots: Record<Side, Element>;
  lcTicks: Record<Side, Element>;
  token: SVGGElement;
  cantonLink: Element;
  packet: HTMLElement;
  canton: HTMLElement;
  bal: Record<Side, HTMLElement>;
  delta: Record<Side, HTMLElement>;
  caption: HTMLElement;
  stepnum: HTMLElement;
  phase: HTMLElement;
  capTitle: HTMLElement;
  capBody: HTMLElement;
  progress: HTMLElement;
  status: HTMLElement;
  keys: HTMLElement;
}

export function mountDiagram(stage: HTMLElement): Els {
  const host = stage.querySelector<HTMLElement>('#diagram')!;
  host.innerHTML = svg();
  const q = <T extends Element>(sel: string) => stage.querySelector<T>(sel)!;
  const all = (attr: string) => [...stage.querySelectorAll(`[data-${attr}]`)];
  const byAttr = <K extends string>(attr: string) =>
    Object.fromEntries(all(attr).map((el) => [el.getAttribute(`data-${attr}`), el])) as Record<K, Element>;
  return {
    stage,
    nodes: new Map(all('node').map((el) => [el.getAttribute('data-node') as NodeId, el])),
    hashes: new Map(all('hash').map((el) => [el.getAttribute('data-hash') as NodeId, el])),
    edges: byAttr<EdgeId>('edge') as Record<EdgeId, SVGPathElement>,
    slots: byAttr<Side>('slot'),
    lcTicks: byAttr<Side>('lctick'),
    token: q<SVGGElement>('.token'),
    cantonLink: q('.canton-link'),
    packet: q('#packet'),
    canton: q('#canton'),
    bal: { b: q('#bal-b'), z: q('#bal-z') },
    delta: { b: q('#d-b'), z: q('#d-z') },
    caption: q('#caption'),
    stepnum: q('#stepnum'),
    phase: q('#phase'),
    capTitle: q('#cap-title'),
    capBody: q('#cap-body'),
    progress: q('#progress'),
    status: q('#status'),
    keys: q('#keys'),
  };
}

function packetHtml(p: PacketCard): string {
  const seq = `seq ${p.sequence ?? '…'}`;
  const rows = p.mode === 'ack'
    ? [['result', 'success'], ['for', p.payload], ['client', CLIENT_ID]]
    : [['client', CLIENT_ID], ['app', 'GMP → IFT'], ['payload', p.payload], ['timeout', 'send + 15 min']];
  return `<div class="card-head"><span class="kicker">${p.mode === 'ack' ? 'ACKNOWLEDGEMENT' : 'PACKET'}</span><span class="meta">${seq}</span></div>
    <div class="kv">${rows.map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join('')}</div>`;
}

function cantonHtml(c: NonNullable<Scene['canton']>): string {
  const ref = c.update ? `update ${esc(c.update)}` : `tx ${esc(short(c.tx))}`;
  return `<div class="card-head"><span class="kicker">CANTON LAYER</span><span class="meta">${ref}</span></div>
    <div class="canton-title">EVM block → Daml <span class="mono">BlockProposal</span></div>
    <div class="pills"><span>participant1 exec</span><span>participant2 ✓</span><span>participant3 ✓</span></div>`;
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

function setNumber(el: HTMLElement, value: number | undefined, animate: boolean) {
  const prev = Number(el.dataset.value ?? NaN);
  el.dataset.value = String(value ?? NaN);
  if (value === undefined) {
    el.dataset.gen = String(Number(el.dataset.gen ?? 0) + 1);
    el.textContent = '—';
  } else if (animate && Number.isFinite(prev) && prev !== value) tweenNumber(el, prev, value, fmt);
  else {
    el.dataset.gen = String(Number(el.dataset.gen ?? 0) + 1); // cancel any running tween
    el.textContent = fmt(value);
  }
}

export function render(scene: Scene, els: Els, opts: { animate: boolean }) {
  for (const [id, el] of els.nodes) {
    el.classList.toggle('active', scene.active.includes(id));
    el.classList.toggle('done', scene.done.includes(id));
  }
  for (const [id, el] of els.hashes) el.textContent = scene.hashes[id] ?? '';
  for (const side of SIDES) {
    els.nodes.get(`${side}-att`)!.classList.toggle('signed', scene.signed.includes(side));
    els.slots[side].setAttribute('class', `commit-slot ${scene.slots[side]}`);
    els.lcTicks[side].classList.toggle('show', scene.lcTick === side);
  }

  for (const id of Object.keys(els.edges) as EdgeId[]) {
    const el = els.edges[id];
    const cur = scene.current.find((r) => r.edge === id);
    const past = scene.traversed.findLast((r) => r.edge === id);
    const sig = scene.sigEdge === id;
    el.classList.toggle('lit', !!cur);
    el.classList.toggle('traversed', !cur && !!past);
    el.classList.toggle('sig', sig);
    el.removeAttribute('marker-start');
    el.removeAttribute('marker-end');
    const run = cur ?? past;
    if (sig) el.setAttribute('marker-end', `url(#arrow-sig-${id[0]})`);
    else if (run) el.setAttribute(run.reverse ? 'marker-start' : 'marker-end', cur ? 'url(#arrow-lit)' : 'url(#arrow)');
  }

  els.packet.classList.toggle('show', !!scene.packet);
  if (scene.packet) els.packet.innerHTML = packetHtml(scene.packet);
  els.canton.classList.toggle('show', !!scene.canton);
  els.canton.classList.toggle('active', scene.active.includes('canton'));
  els.cantonLink.classList.toggle('show', !!scene.canton);
  if (scene.canton) els.canton.innerHTML = cantonHtml(scene.canton);

  setNumber(els.bal.b, scene.balances?.besu, opts.animate);
  setNumber(els.bal.z, scene.balances?.zenith, opts.animate);
  els.delta.b.textContent = scene.delta.besu;
  els.delta.z.textContent = scene.delta.zenith;

  els.stepnum.textContent = scene.caption.num;
  els.phase.textContent = scene.caption.phase;
  els.capTitle.textContent = scene.caption.title;
  els.capBody.textContent = scene.caption.body;
  els.progress.innerHTML = Array.from({ length: scene.total }, (_, k) =>
    `<i class="${k < scene.index ? 'done' : k === scene.index ? 'cur' : ''}"></i>`).join('');
}
