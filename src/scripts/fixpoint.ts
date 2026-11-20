// <ai-fixpoint>: shows a program's equation system and steps through Kleene iteration.
//
//   data-example    initial example id
//   data-examples   comma list of example ids for the picker (default: all)
//   data-domain     initial domain: concrete | signs | signs8   (default: signs8)
//   data-strategy   initial strategy: jacobi | in-order         (default: jacobi)
//   data-widen      intervals only: off | 1 | 3  (widen at loop heads after that many changes; default off)
//   data-narrow     intervals only: on | off     (default off)

import { parse, ParseError } from '../lib/parser';
import type { Program } from '../lib/ast';
import { buildEquations, kleene, kindLabel, type KleeneResult, type Unknown, type Strategy } from '../lib/equations';
import { abstractStates, concreteStates, type StateLattice } from '../lib/states';
import { SignDomain } from '../lib/domains/sign';
import { Signs8Domain } from '../lib/domains/signs8';
import { IntervalDomain } from '../lib/domains/interval';
import { EXAMPLES, example } from '../lib/examples';
import { createEditor, type Annotation } from './editor';
import { h } from './dom';

const DOMAINS: Record<string, { label: string; make: (p: Program) => StateLattice<any>; max: number }> = {
  concrete: { label: 'Concrete sets of states (inputs −3..3)', make: (p) => concreteStates(p.vars, { range: 3 }), max: 40 },
  signs: { label: 'Signs (5 elements)', make: (p) => abstractStates(SignDomain, p.vars), max: 100 },
  signs8: { label: 'Extended signs (8 elements)', make: (p) => abstractStates(Signs8Domain, p.vars), max: 100 },
  intervals: { label: 'Intervals', make: (p) => abstractStates(IntervalDomain, p.vars), max: 250 },
};

const STRATEGIES: Record<Strategy, string> = {
  jacobi: 'All at once (Jacobi)',
  'in-order': 'In order (Gauss–Seidel)',
};

class Fixpoint extends HTMLElement {
  private editor!: ReturnType<typeof createEditor>;
  private domain = 'signs8';
  private strategy: Strategy = 'jacobi';
  private widen = 'off';
  private narrow = 'off';
  private intervalControls!: HTMLElement;
  private round = 0;
  private timer = 0;
  private playing = 0;
  private body!: HTMLElement;
  private stepper!: HTMLElement;
  private state: { p: Program; L: StateLattice<any>; eqs: Unknown<any>[]; r: KleeneResult<any> } | null = null;

  connectedCallback() {
    if (this.editor) return;
    this.domain = this.dataset.domain ?? 'signs8';
    this.strategy = (this.dataset.strategy as Strategy) ?? 'jacobi';
    this.widen = this.dataset.widen ?? 'off';
    this.narrow = this.dataset.narrow ?? 'off';
    const ids = this.dataset.examples ? this.dataset.examples.split(',').map((s) => s.trim()) : EXAMPLES.map((e) => e.id);
    const initial = example(this.dataset.example ?? ids[0]);

    const exSel = h('select', { 'aria-label': 'Example program' },
      ...ids.map((id) => { const o = h('option', { value: id }, example(id).title); o.selected = id === initial.id; return o; })) as HTMLSelectElement;
    exSel.addEventListener('change', () => this.editor.setDoc(example(exSel.value).code));
    const domSel = h('select', { 'aria-label': 'Domain' },
      ...Object.entries(DOMAINS).map(([id, d]) => { const o = h('option', { value: id }, d.label); o.selected = id === this.domain; return o; })) as HTMLSelectElement;
    domSel.addEventListener('change', () => { this.domain = domSel.value; this.recompute(); });
    const wSel = h('select', { 'aria-label': 'Widening' },
      ...[['off', 'Widening: off'], ['1', 'Widening: after 1 change'], ['3', 'Widening: after 3 changes']]
        .map(([v, t]) => { const o = h('option', { value: v }, t); o.selected = v === this.widen; return o; })) as HTMLSelectElement;
    wSel.addEventListener('change', () => { this.widen = wSel.value; this.recompute(); });
    const nSel = h('select', { 'aria-label': 'Narrowing' },
      ...[['off', 'Narrowing: off'], ['on', 'Narrowing: on']]
        .map(([v, t]) => { const o = h('option', { value: v }, t); o.selected = v === this.narrow; return o; })) as HTMLSelectElement;
    nSel.addEventListener('change', () => { this.narrow = nSel.value; this.recompute(); });
    this.intervalControls = h('div', { class: 'toolbar sub' }, wSel, nSel);
    const stSel = h('select', { 'aria-label': 'Iteration strategy' },
      ...Object.entries(STRATEGIES).map(([id, label]) => { const o = h('option', { value: id }, label); o.selected = id === this.strategy; return o; })) as HTMLSelectElement;
    stSel.addEventListener('change', () => { this.strategy = stSel.value as Strategy; this.recompute(); });

    this.stepper = h('div', { class: 'stepper' });
    const editorHost = h('div', { class: 'editor' });
    this.body = h('div', { class: 'panel' });
    this.append(h('div', { class: 'toolbar' }, exSel, domSel, stSel), this.intervalControls, this.stepper, editorHost, this.body);
    this.editor = createEditor(editorHost, initial.code, () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.recompute(), 300);
    });
    this.recompute();
  }

  private recompute() {
    this.stop();
    this.round = 0;
    try {
      const p = parse(this.editor.getDoc());
      const d = DOMAINS[this.domain];
      const L = d.make(p);
      const eqs = buildEquations(p, L);
      const intervals = this.domain === 'intervals';
      this.intervalControls.hidden = !intervals;
      const opts = intervals
        ? { widenDelay: this.widen === 'off' ? null : Number(this.widen), narrowSteps: this.narrow === 'on' ? 5 : 0 }
        : {};
      this.state = { p, L, eqs, r: kleene(eqs, L, this.strategy, d.max, opts) };
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      this.state = null;
      this.editor.decorate(new Map([[e.line, { text: e.message, cls: 'bad' }]]), new Map([[e.line, 'cm-line-error']]));
      this.stepper.replaceChildren();
      this.body.replaceChildren(h('p', { class: 'status bad' }, `Syntax error — ${e.message}`));
      return;
    }
    this.renderStepper();
    this.render();
  }

  private stop() {
    if (this.playing) { clearInterval(this.playing); this.playing = 0; }
  }

  private renderStepper() {
    const { r } = this.state!;
    const last = r.iterates.length - 1;
    const btn = (label: string, title: string, f: () => void) => {
      const b = h('button', { type: 'button', title }, label);
      b.addEventListener('click', () => { this.stop(); f(); this.render(); });
      return b;
    };
    const play = h('button', { type: 'button', title: 'Play', class: 'play' }, '▶ Play');
    play.addEventListener('click', () => {
      if (this.playing) { this.stop(); this.render(); return; }
      if (this.round >= last) this.round = 0;
      this.playing = window.setInterval(() => {
        if (this.round < last) this.round++;
        if (this.round >= last) this.stop();
        this.render();
      }, 700);
      this.render();
    });
    const slider = h('input', { type: 'range', min: '0', max: String(last), value: '0', 'aria-label': 'Round' }) as HTMLInputElement;
    slider.addEventListener('input', () => { this.stop(); this.round = Number(slider.value); this.render(); });
    this.stepper.replaceChildren(
      play,
      btn('⏮', 'Back to ⊥', () => (this.round = 0)),
      btn('◀', 'Previous round', () => (this.round = Math.max(0, this.round - 1))),
      slider,
      btn('▶', 'Next round', () => (this.round = Math.min(last, this.round + 1))),
      btn('⏭', 'Last round', () => (this.round = last)),
      h('span', { class: 'counter' }),
    );
  }

  private render() {
    const { p, L, eqs, r } = this.state!;
    const last = r.iterates.length - 1;
    const k = this.round;
    const X = r.iterates[k];
    const changed = r.changed[k] ?? new Set<string>();

    const showState = (s: any) => (L.isBottom(s) ? '⊥' : p.vars.map((x) => `${x}: ${L.showVar(s, x)}`).join('   '));

    // Editor: current value of each unknown at the end of its line.
    const annots = new Map<number, Annotation>();
    const cls = new Map<number, string>();
    for (const u of eqs) {
      if (u.line === 0) continue;
      const s = X.get(u.key);
      annots.set(u.line, { text: `${u.name} = ${showState(s)}`, cls: L.isBottom(s) ? 'dim' : 'abstract' });
      if (changed.has(u.key)) cls.set(u.line, 'cm-line-current');
    }
    this.editor.decorate(annots, cls);

    (this.stepper.querySelector('input[type=range]') as HTMLInputElement).value = String(k);
    (this.stepper.querySelector('.play') as HTMLElement).textContent = this.playing ? '❚❚ Pause' : '▶ Play';
    this.stepper.querySelector('.counter')!.textContent = `round ${k} / ${last}`;

    const widened = r.widened[k] ?? new Set<string>();
    const anyWiden = r.widened.some((w) => w.size > 0);
    const down = r.phase[k] === 'down';
    const status = k === 0
      ? 'Round 0: every unknown starts at ⊥ ("nothing reaches here yet"). Step forward to apply the equations.'
      : k < last
        ? `Round ${k}${down ? ' (narrowing)' : ''}: ${changed.size} unknown${changed.size === 1 ? '' : 's'} changed (highlighted)${widened.size ? `; widening ∇ jumped at ${[...widened].map((key) => eqs.find((u) => u.key === key)!.name).join(', ')}` : ''}.`
      : !r.stable ? `Still changing after ${last} rounds: this iteration does not converge. ${this.domain === 'concrete' ? 'The concrete sets keep growing.' : 'The intervals keep growing: turn on widening.'} Stopped here.`
      : down ? `Round ${k}: narrowing finished. The result is sound (it is still above the least fixpoint) and more precise than right after widening.`
      : anyWiden ? `Round ${k}: one more round changes nothing. Because of widening this is a post-fixpoint: sound, but maybe not the least fixpoint. Reached after ${last} round${last === 1 ? '' : 's'}.`
      : `Round ${k}: one more round changes nothing, so this is the least fixpoint. Reached after ${last} round${last === 1 ? '' : 's'}.`;
    const statusCls = k === last ? (r.stable ? 'good' : 'bad') : '';

    // Equations, with the ones that changed this round highlighted.
    const eqList = h('ol', { class: 'eqs' }, ...eqs.map((u) => h('li', { class: changed.has(u.key) ? 'changed' : '' },
      h('span', { class: 'lhs' }, u.name), ' = ', h('span', { class: 'rhs' }, u.rhs),
      h('span', { class: 'where' }, u.line ? `line ${u.line}, ${kindLabel(u.kind)}` : kindLabel(u.kind)))));

    // Iteration table: rows are unknowns, columns are rounds 0..k.
    const first = Math.max(0, k - 7);
    const cols: number[] = [];
    for (let i = first; i <= k; i++) cols.push(i);
    const table = h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), ...cols.map((i) => h('th', { class: i === k ? 'cur' : '' },
        `round ${i}${r.widened[i]?.size ? ' ∇' : ''}${r.phase[i] === 'down' ? ' Δ' : ''}`)))),
      h('tbody', {}, ...eqs.map((u) => h('tr', {},
        h('th', {}, u.name),
        ...cols.map((i) => {
          const s = r.iterates[i].get(u.key);
          const td = h('td', { class: `${(r.changed[i] ?? new Set()).has(u.key) ? 'changed' : ''} ${r.widened[i]?.has(u.key) ? 'widened' : ''} ${r.phase[i] === 'down' && (r.changed[i] ?? new Set()).has(u.key) ? 'narrowed' : ''} ${i === k ? 'cur' : ''}` });
          if (L.isBottom(s)) td.append('⊥');
          else for (const x of p.vars) td.append(h('div', {}, `${x}: ${L.showVar(s, x)}`));
          return td;
        })))));

    this.body.replaceChildren(
      h('p', { class: `status ${statusCls}` }, status),
      h('details', { open: '' }, h('summary', {}, 'Equations'), eqList),
      h('details', { open: '' }, h('summary', {}, first > 0 ? `Iteration table (last 8 rounds)` : 'Iteration table'), h('div', { class: 'table-wrap' }, table)),
    );
  }
}

customElements.define('ai-fixpoint', Fixpoint);
