// Wiring: keyboard → engine → scene → diagram.
//
//   ?live                          drive the real PoC through demo-ui/server
//   ?step=N&journey=forward|return show step N instantly (scripted; for screenshots)

import './style.css';
import { playMoves, placeToken, cancelMoves } from './animate';
import { mountDiagram, render } from './diagram';
import { Engine, dataFrom, type EngineChange } from './engine';
import { buildJourney, waitingLabel } from './journeys';
import { sceneAt } from './scene';
import { fetchHealth, healthProblem, liveSource } from './sources/live';
import { SCRIPTED, scriptedSource } from './sources/scripted';
import type { Checkpoint, Direction, Source } from './types';

type LogLine = Extract<Checkpoint, { kind: 'log' }>;
const LOG_ROWS = 5;
const logEl = document.getElementById('log')!;
let logs: LogLine[] = [];
let logHidden = false;

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;
const els = mountDiagram(stage);

let live = params.has('live');
let source: Source = live ? liveSource() : scriptedSource;
let started = false;

// Live mode plays itself: each step stays up for DWELL_MS, and a step that
// needs a chain event holds until the event lands. Recorded mode is manual.
const DWELL_MS = 2600;
let autoTimer: number | undefined;
let paused = false;

function clearAuto() {
  clearTimeout(autoTimer);
  autoTimer = undefined;
}

function scheduleAuto() {
  clearAuto();
  if (!live || paused || !started || engine.index >= engine.last || engine.data.error) return;
  const e = engine;
  autoTimer = window.setTimeout(() => {
    if (e === engine) e.next();
  }, DWELL_MS);
}
let healthMsg: string | null = null;
let engine = newEngine(params.get('journey') === 'return' ? 'return' : 'forward');

/** Scripted takes show the starting balances on the ready screen; live waits for the server. */
function newEngine(dir: Direction) {
  const preload = live ? {} : dataFrom(SCRIPTED[dir].filter((cp) => cp.kind === 'balances' || cp.kind === 'meta'));
  return new Engine(buildJourney(dir, live ? 10 : undefined), preload, update);
}

function update(kind: EngineChange) {
  const scene = sceneAt(engine.journey, engine.index, engine.data);
  const forward = kind === 'advance';
  if (!forward && kind !== 'data') stage.classList.add('instant');
  render(scene, els, { animate: forward });
  if (forward) {
    void playMoves(els, scene);
    scheduleAuto();
  }
  else if (kind !== 'data' && kind !== 'waiting') placeToken(els, scene);
  requestAnimationFrame(() => stage.classList.remove('instant'));
  renderStatus();
}

function renderStatus() {
  const d = engine.data;
  const need = engine.nextNeed();
  let text = '', cls = 'status';
  if (d.error) {
    text = d.error + (live ? ' Press S to continue scripted.' : '');
    cls += ' error';
  } else if (engine.waiting && need) {
    text = waitingLabel(engine.journey, need);
    cls += ' waiting';
  } else if (engine.index === -1 && live && healthMsg) {
    text = healthMsg;
    cls += ' error';
  }
  els.status.textContent = text;
  els.status.className = cls;
  els.caption.classList.toggle('waiting', engine.waiting && !d.error);
  els.keys.textContent = engine.index === -1 && !started
    ? '1 forward · 2 return · space send'
    : !live
      ? 'space next · ← back · R restart'
      : paused
        ? 'paused · P resume · space next · ← back'
        : 'space skip · P pause · ← back · R restart';
}

const esc = (v: string) => v.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB');

function renderLog() {
  logEl.classList.toggle('show', live && !logHidden);
  const rows = logs.slice(-LOG_ROWS).map((l) =>
    `<div class="row${l.text.startsWith('error') ? ' err' : ''}"><span class="t">${clock(l.at)}</span><span class="src ${l.source}">${l.source === 'relayer' ? 'relayer' : 'ui'}</span><span class="msg">${esc(l.text)}</span></div>`);
  logEl.innerHTML = `<div class="card-head"><span class="kicker">LIVE LOG</span><span class="meta">relayer · 41003 ⇄ 936485</span></div>`
    + (rows.join('') || '<div class="row idle"><span class="msg">ready · press space to send</span></div>');
}

/** Routes a source event: log lines to the panel, everything else to the engine. */
function route(e: Engine) {
  return (cp: Checkpoint) => {
    if (e !== engine) return;
    if (cp.kind === 'log') {
      logs.push(cp);
      renderLog();
    } else e.receive(cp);
  };
}

async function next() {
  const e = engine; // R or S may replace the engine while start() is in flight
  if (e.index === -1 && !started) {
    started = true;
    renderStatus();
    try {
      await source.start(e.journey.direction, route(e));
    } catch (err) {
      e.receive({ kind: 'error', message: (err as Error).message });
    }
  }
  if (e !== engine) return;
  clearAuto();
  e.next();
}

function restart(dir: Direction) {
  clearAuto();
  paused = false;
  source.stop();
  cancelMoves();
  started = false;
  logs = [];
  engine = newEngine(dir);
  update('jump');
  renderLog();
}

/** Live run went wrong on camera: keep the step and everything already shown,
 *  and fill in the remaining steps from recorded data. */
function fallbackToScripted() {
  const { error: _error, status: _status, ...seen } = engine.data;
  clearAuto();
  const at = engine.index;
  const dir = engine.journey.direction;
  source.stop();
  live = false;
  source = scriptedSource;
  const known = Object.fromEntries(Object.entries(seen).filter(([, v]) => v !== undefined));
  engine = new Engine(buildJourney(dir), { ...dataFrom(SCRIPTED[dir]), ...known }, update);
  started = true;
  engine.jumpTo(at);
}

addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'arrowright') {
    e.preventDefault();
    void next();
  } else if (k === 'arrowleft') {
    clearAuto();
    paused = live; // going back in a live take hands control to the presenter
    engine.back();
  } else if (k === 'p' && live && started) {
    paused = !paused;
    if (paused) clearAuto();
    else scheduleAuto();
    renderStatus();
  }
  else if (k === 'r') restart(engine.journey.direction);
  else if ((k === '1' || k === '2') && engine.index === -1 && !started) restart(k === '1' ? 'forward' : 'return');
  else if (k === 's' && live) {
    fallbackToScripted();
    renderLog();
  } else if (k === 'l') {
    logHidden = !logHidden;
    renderLog();
  }
});

function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
addEventListener('resize', fit);
fit();

const step = Number(params.get('step'));
if (step > 0 && !live) {
  started = true;
  void scriptedSource.start(engine.journey.direction, (cp) => engine.receive(cp));
  engine.jumpTo(step - 1);
} else {
  update('jump');
}

renderLog();
if (live) {
  fetchHealth().then((h) => {
    healthMsg = healthProblem(h);
    renderStatus();
  });
}
