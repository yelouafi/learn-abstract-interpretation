// <ai-worklist>: draws a program's control-flow graph and animates the solver on it.
//
//   data-example    initial example id
//   data-examples   comma list of example ids for the picker (default: all)
//   data-domain     signs8 | intervals | parity                 (default: signs8)
//   data-order      fifo | rpo | recursive                      (default: fifo)

import { parse } from '../lib/parser';
import type { Program } from '../lib/ast';
import { buildCfg, showEdge, showWto, weakTopologicalOrder, type Cfg } from '../lib/cfg';
import { worklistSolve, type Order, type WorklistResult } from '../lib/worklist';
import { buildEquations, kleene } from '../lib/equations';
import { abstractStates, type StateLattice } from '../lib/states';
import { Signs8Domain } from '../lib/domains/signs8';
import { IntervalDomain } from '../lib/domains/interval';
import { ParityDomain } from '../lib/domains/parity';
import type { ValueDomain } from '../lib/domain';
import { EXAMPLES, example } from '../lib/examples';
import { h } from './dom';

const DOMAINS: Record<string, { label: string; D: ValueDomain<any>; opts: { widenDelay?: number; narrowSteps?: number } }> = {
  signs8: { label: 'Extended signs', D: Signs8Domain, opts: {} },
  intervals: { label: 'Intervals (widening + narrowing)', D: IntervalDomain, opts: { widenDelay: 2, narrowSteps: 3 } },
  parity: { label: 'Parity', D: ParityDomain, opts: {} },
};
const ORDERS: Record<Order, string> = {
  fifo: 'Worklist, first in first out',
  rpo: 'Worklist, priority to earliest node',
  recursive: 'Recursive: stabilize loops first',
};

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag: string, attrs: Record<string, string | number> = {}, text?: string) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
};

interface Model {
  p: Program;
  cfg: Cfg;
  L: StateLattice<any>;
  r: WorklistResult<any>;
  /** snapshots[k]: values after k steps */
  snapshots: Map<string, any>[];
  roundRobin: number;
}

class WorklistWidget extends HTMLElement {
  private exId = 'countdown';
  private domain = 'signs8';
  private order: Order = 'fifo';
  private step = 0;
  private playing = 0;
  private model!: Model;
  private graph!: HTMLElement;
  private code!: HTMLElement;
  private info!: HTMLElement;
  private stepper!: HTMLElement;

  connectedCallback() {
    if (this.graph) return;
    const ids = this.dataset.examples ? this.dataset.examples.split(',').map((x) => x.trim()) : EXAMPLES.map((e) => e.id);
    this.exId = this.dataset.example ?? ids[0];
    this.domain = this.dataset.domain ?? 'signs8';
    this.order = (this.dataset.order as Order) ?? 'fifo';
    const sel = (label: string, opts: [string, string][], value: string, on: (v: string) => void) => {
      const el = h('select', { 'aria-label': label }, ...opts.map(([v, t]) => {
        const o = h('option', { value: v }, t) as HTMLOptionElement; o.selected = v === value; return o;
      })) as HTMLSelectElement;
      el.addEventListener('change', () => on(el.value));
      return el;
    };
    const toolbar = h('div', { class: 'toolbar' },
      sel('Example program', ids.map((id) => [id, example(id).title]), this.exId, (v) => { this.exId = v; this.recompute(); }),
      sel('Domain', Object.entries(DOMAINS).map(([k, d]) => [k, d.label]), this.domain, (v) => { this.domain = v; this.recompute(); }),
      sel('Strategy', Object.entries(ORDERS) as [string, string][], this.order, (v) => { this.order = v as Order; this.recompute(); }));
    this.stepper = h('div', { class: 'stepper' });
    this.graph = h('div', { class: 'graph' });
    this.code = h('pre', { class: 'code' });
    this.info = h('div', { class: 'info' });
    this.append(toolbar, this.stepper, h('div', { class: 'main' }, this.graph, this.code), this.info);
    this.recompute();
  }

  private stop() { if (this.playing) { clearInterval(this.playing); this.playing = 0; } }

  private recompute() {
    this.stop();
    const p = parse(example(this.exId).code);
    const cfg = buildCfg(p);
    const d = DOMAINS[this.domain];
    const L = abstractStates(d.D, p.vars);
    const r = worklistSolve(cfg, L, { order: this.order, ...d.opts, maxSteps: 2000 });
    const snapshots: Map<string, any>[] = [new Map(cfg.nodes.map((n) => [n.key, L.bottom]))];
    for (const st of r.steps) {
      const next = new Map(snapshots.at(-1)!);
      next.set(st.node, st.after);
      snapshots.push(next);
    }
    const eqs = buildEquations(p, L);
    const roundRobin = kleene(eqs, L, 'in-order', 300, d.opts).iterates.length * eqs.length;
    this.model = { p, cfg, L, r, snapshots, roundRobin };
    this.step = 0;
    this.code.replaceChildren(...example(this.exId).code.trimEnd().split('\n').map((line, i) =>
      h('div', { 'data-line': String(i + 1) }, h('span', { class: 'ln' }, String(i + 1).padStart(2)), ' ' + line)));
    this.renderStepper();
    this.render();
  }

  private renderStepper() {
    const last = this.model.r.steps.length;
    const btn = (label: string, title: string, f: () => void) => {
      const b = h('button', { type: 'button', title }, label);
      b.addEventListener('click', () => { this.stop(); f(); this.render(); });
      return b;
    };
    const play = h('button', { type: 'button', class: 'play' }, '▶ Play');
    play.addEventListener('click', () => {
      if (this.playing) { this.stop(); this.render(); return; }
      if (this.step >= last) this.step = 0;
      this.playing = window.setInterval(() => {
        if (this.step < last) this.step++;
        if (this.step >= last) this.stop();
        this.render();
      }, 650);
      this.render();
    });
    const slider = h('input', { type: 'range', min: '0', max: String(last), value: '0', 'aria-label': 'Step' }) as HTMLInputElement;
    slider.addEventListener('input', () => { this.stop(); this.step = Number(slider.value); this.render(); });
    this.stepper.replaceChildren(play,
      btn('⏮', 'Start', () => (this.step = 0)),
      btn('◀', 'Previous step', () => (this.step = Math.max(0, this.step - 1))),
      slider,
      btn('▶', 'Next step', () => (this.step = Math.min(last, this.step + 1))),
      btn('⏭', 'Last step', () => (this.step = last)),
      h('span', { class: 'counter' }));
  }

  private render() {
    const { p, cfg, L, r, snapshots, roundRobin } = this.model;
    const k = this.step;
    const last = r.steps.length;
    const X = snapshots[k];
    const cur = k > 0 ? r.steps[k - 1] : null;
    const pending = new Set(cur ? cur.worklist : [cfg.entry]);
    const nameOf = (key: string) => cfg.nodes.find((n) => n.key === key)!.name;
    const showState = (st: any) => (L.isBottom(st) ? '⊥' : p.vars.map((x) => `${x}: ${L.showVar(st, x)}`).join('  '));

    (this.stepper.querySelector('input[type=range]') as HTMLInputElement).value = String(k);
    (this.stepper.querySelector('.play') as HTMLElement).textContent = this.playing ? '❚❚ Pause' : '▶ Play';
    this.stepper.querySelector('.counter')!.textContent = `step ${k} / ${last}`;

    // ---- the graph ----
    const idx = new Map(cfg.nodes.map((n, i) => [n.key, i]));
    const rowH = 46, top = 22;
    const y = (key: string) => top + idx.get(key)! * rowH;
    type Arc = { e: typeof cfg.edges[number]; lo: number; hi: number; level: number; back: boolean };
    const arcs: Arc[] = [];
    for (const e of cfg.edges) {
      const a = idx.get(e.from)!, b = idx.get(e.to)!;
      if (b === a + 1) continue;
      arcs.push({ e, lo: Math.min(a, b), hi: Math.max(a, b), level: 0, back: b <= a });
    }
    arcs.sort((u, v) => (u.hi - u.lo) - (v.hi - v.lo));
    for (const a of arcs) {
      let level = 1;
      while (arcs.some((o) => o !== a && o.level === level && o.lo <= a.hi && a.lo <= o.hi)) level++;
      a.level = level;
    }
    const maxLevel = Math.max(0, ...arcs.map((a) => a.level));
    const labelRoom = Math.min(150, Math.max(40, ...arcs.map((a) => showEdge(a.e).length * 6.2)));
    const col = 14 + labelRoom + maxLevel * 22 + 18;
    const width = col + 360;
    const height = top + cfg.nodes.length * rowH;
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Control-flow graph' });
    const defs = s('defs');
    for (const [id, cls] of [['arrow', 'arrowhead'], ['arrow-back', 'arrowhead back']]) {
      const m = s('marker', { id: `${id}-${this.id || 'w'}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
      m.append(s('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }));
      defs.append(m);
    }
    svg.append(defs);
    const mark = (back: boolean) => `url(#${back ? 'arrow-back' : 'arrow'}-${this.id || 'w'})`;
    const label = (x: number, yy: number, text: string, anchor: string) =>
      s('text', { x, y: yy, 'text-anchor': anchor, class: 'elabel' }, text);

    for (const e of cfg.edges) {
      const a = idx.get(e.from)!, b = idx.get(e.to)!;
      if (b !== a + 1) continue;
      svg.append(s('line', { x1: col, y1: y(e.from) + 14, x2: col, y2: y(e.to) - 15, class: 'edge', 'marker-end': mark(false) }));
      const t = showEdge(e);
      if (t !== 'skip') svg.append(label(col + 10, (y(e.from) + y(e.to)) / 2 + 4, t, 'start'));
    }
    for (const a of arcs) {
      const y1 = y(a.e.from), y2 = y(a.e.to), dx = 14 + a.level * 22;
      svg.append(s('path', {
        d: `M${col - 13},${y1} C${col - dx * 1.35},${y1} ${col - dx * 1.35},${y2} ${col - 14},${y2}`,
        class: `edge arc${a.back ? ' back' : ''}`, 'marker-end': mark(a.back),
      }));
      const t = showEdge(a.e);
      // Label just below the source node, on the left: one row per source, so labels don't collide.
      if (t !== 'skip') svg.append(label(col - 18, y1 + (a.back ? -10 : 22), t, 'end'));
    }
    for (const n of cfg.nodes) {
      const yy = y(n.key);
      const g = s('g', { class: 'node' });
      if (cur && cur.node === n.key) g.classList.add('current');
      if (pending.has(n.key)) g.classList.add('pending');
      if (r.wideningPoints.has(n.key)) g.classList.add('wpoint');
      if (r.wideningPoints.has(n.key)) g.append(s('circle', { cx: col, cy: yy, r: 17, class: 'ring' }));
      g.append(s('circle', { cx: col, cy: yy, r: 13 }));
      g.append(s('text', { x: col, y: yy + 4, 'text-anchor': 'middle', class: 'nname' }, n.name));
      const v = X.get(n.key);
      g.append(s('text', { x: col + 24, y: yy + 4, class: `nval${cur && cur.node === n.key && cur.changed ? ' changed' : ''}` },
        `${n.line ? `line ${n.line}` : 'start'}  ${showState(v)}`));
      svg.append(g);
    }
    this.graph.replaceChildren(svg);

    // Highlight the current node's line in the code listing.
    const curLine = cur ? cfg.nodes.find((n) => n.key === cur.node)!.line : -1;
    this.code.querySelectorAll<HTMLElement>('[data-line]').forEach((el) => el.classList.toggle('cur', Number(el.dataset.line) === curLine));

    // ---- text ----
    let what: string;
    if (!cur) {
      what = this.order === 'recursive'
        ? 'Start: every node is ⊥. The recursive strategy walks the weak topological order below, repeating each loop until its head is stable.'
        : `Start: every node is ⊥ and the worklist holds only the entry ${nameOf(cfg.entry)}.`;
    } else {
      const n = nameOf(cur.node);
      const phase = cur.phase === 'down' ? 'Narrowing: re-evaluate' : 'Evaluate';
      what = `${phase} ${n}: ${cur.changed ? `changed to ${showState(cur.after)}` : 'no change'}`
        + (cur.widened ? ' (widening ∇ jumped)' : '')
        + (cur.added.length ? `; add ${cur.added.map(nameOf).join(', ')} to the worklist.` : '.');
    }
    const done = k === last
      ? (r.stable ? `Done after ${last} evaluations. Round-robin iteration (chapter 5, in order${this.domain === 'intervals' ? ', same widening' : ''}) needs ${roundRobin}.` : `Stopped after ${last} evaluations.`)
      : '';
    const wl = this.order === 'recursive' ? [] : [...pending];
    this.info.replaceChildren(
      h('p', { class: 'what' }, what),
      this.order === 'recursive'
        ? h('p', { class: 'wl' }, 'Weak topological order: ', h('code', {}, showWto(weakTopologicalOrder(cfg), nameOf)))
        : h('p', { class: 'wl' }, 'Worklist: ', ...(wl.length ? wl.map((x) => h('span', { class: 'chip' }, nameOf(x))) : [h('span', { class: 'muted' }, 'empty')])),
      done ? h('p', { class: 'done' }, done) : '',
      h('details', {}, h('summary', {}, `Edges (${cfg.edges.length})`),
        h('ul', { class: 'edges' }, ...cfg.edges.map((e) => h('li', {}, `${nameOf(e.from)} → ${nameOf(e.to)}: ${showEdge(e)}`)))),
    );
  }
}

customElements.define('ai-worklist', WorklistWidget);
