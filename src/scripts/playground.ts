// <ai-playground>: an editor plus one or more ways of "running" the program.
//
//   data-modes     comma list of: run, collect, signs        (default: all three)
//   data-example   id of the initial example                  (default: first)
//   data-examples  comma list of example ids for the picker   (default: all)
//   data-inputs    initial inputs for run mode, e.g. "3, -1"
//   data-compare   "true" to open the "compare with testing" table in signs mode
//   data-domains   comma list of domain ids for signs mode (default: "signs"); a picker
//                  appears when there is more than one

import { parse, ParseError } from '../lib/parser';
import type { Program } from '../lib/ast';
import { run, programPoints, type Env, type Point } from '../lib/interp';
import { collect } from '../lib/collecting';
import { analyze, type AEnv } from '../lib/analyzer';
import type { ValueDomain } from '../lib/domain';
import { domainById, alphaOf, type DomainEntry } from '../lib/domains';
import { EXAMPLES, example } from '../lib/examples';
import { createEditor, type Annotation } from './editor';
import { h } from './dom';

type Mode = 'run' | 'collect' | 'signs';
const MODE_LABEL: Record<Mode, string> = { run: '▶ Run once', collect: '∪ All inputs (testing)', signs: '± Sign analysis' };


/** For each source line, the last program point displayed on it. */
function pointsByLine(p: Program): Map<number, Point> {
  const m = new Map<number, Point>();
  for (const pt of programPoints(p)) m.set(pt.line, pt);
  return m;
}

const showEnv = (env: Env) => Object.entries(env).map(([k, v]) => `${k}=${v}`).join('  ');
const showAEnv = <V>(D: ValueDomain<V>, env: AEnv<V>) =>
  env ? Object.entries(env).map(([k, v]) => `${k}: ${D.show(v)}`).join('   ') : '⊥ unreachable';

function showSet(ns: number[]): string {
  const s = [...new Set(ns)].sort((a, b) => a - b);
  if (s.length === 0) return '∅';
  const contiguous = s.at(-1)! - s[0] === s.length - 1;
  if (contiguous && s.length > 3) return `{${s[0]}..${s.at(-1)}}`;
  if (s.length > 6) return `{${s.slice(0, 3).join(', ')}, …, ${s.at(-1)}} (${s.length} values)`;
  return `{${s.join(', ')}}`;
}

class Playground extends HTMLElement {
  private modes: Mode[] = [];
  private mode!: Mode;
  private editor!: ReturnType<typeof createEditor>;
  private controls!: HTMLElement;
  private panel!: HTMLElement;
  private timer = 0;
  private step = -1;
  private inputs = '';
  private range = 3;
  private compare = false;
  private domains: DomainEntry[] = [];
  private domain!: DomainEntry;

  connectedCallback() {
    if (this.editor) return;
    this.modes = ((this.dataset.modes ?? 'run,collect,signs').split(',').map((s) => s.trim()) as Mode[]);
    this.mode = this.modes[0];
    this.inputs = this.dataset.inputs ?? '3';
    this.compare = this.dataset.compare === 'true';
    this.domains = (this.dataset.domains ?? 'signs').split(',').map((s) => domainById(s.trim()));
    this.domain = this.domains[0];
    const ids = this.dataset.examples ? this.dataset.examples.split(',').map((s) => s.trim()) : EXAMPLES.map((e) => e.id);
    const initial = example(this.dataset.example ?? ids[0]);

    const select = h('select', { 'aria-label': 'Example program' },
      ...ids.map((id) => { const o = h('option', { value: id }, example(id).title); if (id === initial.id) o.selected = true; return o; }));
    select.addEventListener('change', () => { this.editor.setDoc(example(select.value).code); this.step = -1; });

    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    if (this.modes.length > 1) {
      for (const m of this.modes) {
        const label = m === 'signs' && this.domains.some((d) => d.id === 'intervals') ? '⊑ Abstract analysis' : MODE_LABEL[m];
        const b = h('button', { type: 'button', role: 'tab', 'data-mode': m }, label);
        b.addEventListener('click', () => { this.mode = m; this.refresh(); });
        tabs.append(b);
      }
    }

    this.controls = h('div', { class: 'controls' });
    const editorHost = h('div', { class: 'editor' });
    this.panel = h('div', { class: 'panel' });
    this.append(h('div', { class: 'toolbar' }, select, tabs), this.controls, editorHost, this.panel);

    this.editor = createEditor(editorHost, initial.code, () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => { this.step = -1; this.refresh(); }, 250);
    });
    this.refresh();
  }

  private refresh() {
    this.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === this.mode)));
    this.controls.replaceChildren();
    this.panel.replaceChildren();
    let p: Program;
    try {
      p = parse(this.editor.getDoc());
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      this.editor.decorate(new Map([[e.line, { text: e.message, cls: 'bad' }]]), new Map([[e.line, 'cm-line-error']]));
      this.panel.append(h('p', { class: 'status bad' }, `Syntax error — ${e.message}`));
      return;
    }
    if (this.mode === 'run') this.showRun(p);
    else if (this.mode === 'collect') this.showCollect(p);
    else this.showSigns(p);
  }

  // ---- concrete execution ----------------------------------------------------------
  private showRun(p: Program) {
    const field = h('input', { type: 'text', value: this.inputs, 'aria-label': 'Inputs', spellcheck: 'false' }) as HTMLInputElement;
    field.addEventListener('input', () => { this.inputs = field.value; this.step = -1; clearTimeout(this.timer); this.timer = window.setTimeout(() => this.refresh(), 300); });
    this.controls.append(h('label', {}, 'Inputs ', field), h('span', { class: 'hint' }, 'successive values returned by input(); missing ones are 0'));

    const values = this.inputs.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n)).map(Math.trunc);
    const res = run(p, { input: (i) => values[i] ?? 0, fuel: 1000 });
    const n = res.trace.length;
    if (this.step < 0 || this.step >= n) this.step = n - 1;

    const render = () => {
      const last = new Map<number, Env>();
      for (let i = 0; i <= this.step; i++) last.set(res.trace[i].line, res.trace[i].env);
      const annots = new Map<number, Annotation>();
      for (const [ln, env] of last) annots.set(ln, { text: showEnv(env), cls: 'concrete' });
      const cls = new Map<number, string>();
      const cur = res.trace[this.step];
      if (cur) cls.set(cur.line, 'cm-line-current');
      const s = res.status;
      if (s.kind !== 'ok' && s.kind !== 'out-of-fuel' && this.step === n - 1) cls.set(s.line, 'cm-line-error');
      this.editor.decorate(annots, cls);
      counter.textContent = n ? `step ${this.step + 1} / ${n}` : 'no steps';
      slider.value = String(this.step);
    };

    const slider = h('input', { type: 'range', min: '0', max: String(Math.max(0, n - 1)), value: String(this.step), 'aria-label': 'Step' }) as HTMLInputElement;
    slider.addEventListener('input', () => { this.step = Number(slider.value); render(); });
    const btn = (label: string, title: string, f: () => void) => {
      const b = h('button', { type: 'button', title }, label); b.addEventListener('click', () => { f(); render(); }); return b;
    };
    const counter = h('span', { class: 'counter' });
    const s = res.status;
    const statusText =
      s.kind === 'ok' ? '✓ finished normally'
      : s.kind === 'assert-failed' ? `✗ assertion failed on line ${s.line}`
      : s.kind === 'error' ? `✗ ${s.message} on line ${s.line}`
      : '∞ stopped after 1000 loop iterations (probably does not terminate)';
    this.panel.append(
      h('div', { class: 'stepper' },
        btn('⏮', 'First step', () => (this.step = 0)),
        btn('◀', 'Previous step', () => (this.step = Math.max(0, this.step - 1))),
        slider,
        btn('▶', 'Next step', () => (this.step = Math.min(n - 1, this.step + 1))),
        btn('⏭', 'Last step', () => (this.step = n - 1)),
        counter),
      h('p', { class: `status ${s.kind === 'ok' ? 'good' : 'bad'}` }, statusText,
        res.inputsUsed.length ? h('span', { class: 'muted' }, `inputs read: ${res.inputsUsed.join(', ')}`) : ''),
    );
    render();
  }

  // ---- collecting semantics by exhaustive testing -----------------------------------
  private showCollect(p: Program) {
    const r = h('input', { type: 'number', min: '1', max: '6', value: String(this.range), 'aria-label': 'Input range' }) as HTMLInputElement;
    r.addEventListener('change', () => { this.range = Math.min(6, Math.max(1, Number(r.value) || 1)); this.refresh(); });
    this.controls.append(h('label', {}, 'Every input() ranges over −N..N, N = ', r));

    const c = collect(p, { range: this.range, maxRuns: 2000, fuel: 300 });
    const annots = new Map<number, Annotation>();
    for (const [ln, pt] of pointsByLine(p)) {
      const envs = c.states.get(pt.key);
      if (!envs?.length) { annots.set(ln, { text: 'never reached', cls: 'dim' }); continue; }
      const text = p.vars.map((x) => `${x} ∈ ${showSet(envs.map((e) => e[x]))}`).join('   ');
      annots.set(ln, { text, cls: 'concrete', title: `${envs.length} distinct states` });
    }
    const cls = new Map<number, string>();
    const count = { ok: 0, 'assert-failed': 0, error: 0, 'out-of-fuel': 0 };
    for (const run of c.runs) {
      count[run.status.kind]++;
      if (run.status.kind === 'assert-failed' || run.status.kind === 'error') cls.set(run.status.line, 'cm-line-error');
    }
    this.editor.decorate(annots, cls);
    const parts = [`${c.runs.length} runs${c.truncated ? ' (stopped early: too many input combinations)' : ''}`, `${count.ok} finished`];
    if (count['assert-failed']) parts.push(`${count['assert-failed']} failed an assertion`);
    if (count.error) parts.push(`${count.error} crashed`);
    if (count['out-of-fuel']) parts.push(`${count['out-of-fuel']} did not terminate`);
    this.panel.append(h('p', { class: `status ${count['assert-failed'] + count.error ? 'bad' : 'good'}` }, parts.join(' · ')),
      h('p', { class: 'hint' }, 'Each line shows, per variable, every value seen at that point over all runs. This is testing: it can only show bugs that the chosen inputs happen to trigger.'));
  }

  // ---- sign analysis ----------------------------------------------------------------
  private showSigns(p: Program) {
    const D: ValueDomain<any> = this.domain.domain;
    const a = analyze(p, D);
    const annots = new Map<number, Annotation>();
    const cls = new Map<number, string>();
    for (const [ln, pt] of pointsByLine(p)) {
      const env = a.states.get(pt.key) ?? null;
      annots.set(ln, { text: showAEnv(D, env), cls: env ? 'abstract' : 'dim' });
    }
    for (const al of a.alarms) {
      cls.set(al.line, al.severity === 'error' ? 'cm-line-error' : 'cm-line-warn');
    }
    // Assertion verdicts get a badge in front of the state.
    const walk = (ss: Program['body']) => ss.forEach((s) => {
      if (s.kind === 'assert') {
        const v = a.asserts.get(s.id)!;
        const badge = { proved: '✓ proved', fails: '✗ always fails', unknown: '⚠ may fail', unreachable: '· unreachable' }[v];
        const prev = annots.get(s.line);
        annots.set(s.line, { text: `${badge}   ${prev?.text ?? ''}`, cls: v === 'proved' ? 'good' : v === 'unreachable' ? 'dim' : 'warn' });
        if (v === 'proved') cls.set(s.line, 'cm-line-ok');
      }
      if (s.kind === 'if') { walk(s.then); walk(s.else); }
      if (s.kind === 'while') walk(s.body);
    });
    walk(p.body);
    this.editor.decorate(annots, cls);

    const toggle = h('input', { type: 'checkbox' }) as HTMLInputElement;
    toggle.checked = this.compare;
    toggle.addEventListener('change', () => { this.compare = toggle.checked; this.refresh(); });
    if (this.domains.length > 1) {
      const pick = h('select', { 'aria-label': 'Abstract domain' },
        ...this.domains.map((d) => { const o = h('option', { value: d.id }, d.label); o.selected = d === this.domain; return o; })) as HTMLSelectElement;
      pick.addEventListener('change', () => { this.domain = domainById(pick.value); this.refresh(); });
      this.controls.append(h('label', {}, 'Domain ', pick));
    }
    this.controls.append(h('label', {}, toggle, ' Compare with testing'));

    const alarms = a.alarms.length
      ? h('ul', { class: 'alarms' }, ...a.alarms.map((al) => h('li', { class: al.severity }, `Line ${al.line}: ${al.message}`)))
      : h('p', { class: 'status good' }, '✓ No alarms: the analyzer proved the absence of division by zero and assertion failures, for every input.');
    this.panel.append(alarms);

    const loops = [...a.iterations].filter(([, hist]) => hist.length > 0);
    if (loops.length) {
      const pts = programPoints(p);
      const det = h('details', {}, h('summary', {}, 'Loop iterations (how the analyzer found each loop invariant)'));
      for (const [id, hist] of loops) {
        const line = pts.find((q) => q.key === `head:${id}`)?.line;
        det.append(h('p', { class: 'hint' }, `Loop on line ${line}: ${hist.length} iteration${hist.length > 1 ? 's' : ''} until stable`),
          h('ol', { class: 'iters' }, ...hist.map((e, i) => {
            const kind = a.iterationKinds.get(id)?.[i];
            const tag = kind === 'widen' ? '∇ widen  ' : kind === 'narrow' ? 'Δ narrow  ' : '';
            return h('li', {}, tag + showAEnv(D, e));
          })));
      }
      this.panel.append(det);
    }

    if (this.compare) this.panel.append(this.compareTable(p, D, a.states));
  }

  private compareTable<V>(p: Program, D: ValueDomain<V>, states: Map<string, AEnv<V>>) {
    const c = collect(p, { range: 3, maxRuns: 2000, fuel: 300 });
    const tbody = h('tbody');
    for (const pt of programPoints(p)) {
      const envs = c.states.get(pt.key) ?? [];
      const abs = states.get(pt.key) ?? null;
      p.vars.forEach((x, i) => {
        const seen = envs.map((e) => e[x]);
        const alpha = alphaOf(D, seen);
        const an: V = abs ? abs[x] : D.bottom;
        const verdict = !D.leq(alpha, an) ? ['UNSOUND', 'bad'] : D.leq(an, alpha) ? ['exact', 'good'] : ['over-approximated', 'warn'];
        tbody.append(h('tr', {},
          i === 0 ? Object.assign(h('td', { class: 'ln' }, String(pt.line)), { rowSpan: p.vars.length }) : '',
          h('td', {}, x),
          h('td', {}, envs.length ? showSet(seen) : 'never reached'),
          h('td', { class: 'sym' }, D.show(alpha)),
          h('td', { class: 'sym' }, D.show(an)),
          h('td', { class: verdict[1] }, verdict[0])));
      });
    }
    return h('div', { class: 'compare' },
      h('p', { class: 'hint' }, 'Testing runs every input in −3..3. α(seen) is the most precise abstract value describing the values tests saw. Soundness means the analysis is never below α(seen); "over-approximated" marks where it lost precision (or where tests were not exhaustive).'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ...['Line', 'Var', 'Values seen in tests', 'α(seen)', 'Analysis', ''].map((t) => h('th', {}, t)))),
        tbody)));
  }
}

customElements.define('ai-playground', Playground);
