// <ai-zoneplot>: what intervals and zones say about two variables at one program point,
// drawn in the plane next to the states that tests actually reach.
//
//   data-example    initial example id
//   data-examples   comma list of example ids for the picker (default: the initial one)
//   data-line       initial program point, by source line (default: first loop head)
//   data-vars       initial pair, e.g. "x,y" (default: the first two variables)

import { parse } from '../lib/parser';
import type { Program } from '../lib/ast';
import { programPoints, type Point } from '../lib/interp';
import { collect } from '../lib/collecting';
import { analyze, analyzeStates } from '../lib/analyzer';
import { IntervalDomain, showInterval, type Interval } from '../lib/domains/interval';
import { zoneStates, type ZoneLattice, type Zone } from '../lib/domains/zones';
import { example } from '../lib/examples';
import { h } from './dom';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag: string, attrs: Record<string, string | number> = {}, text?: string) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
};

type Pt = [number, number];
/** a·X + b·Y ≤ c */
type HalfPlane = [number, number, number];

/** Sutherland–Hodgman: clip a convex polygon by a half-plane. */
function clip(poly: Pt[], [a, b, c]: HalfPlane): Pt[] {
  const out: Pt[] = [];
  const val = ([x, y]: Pt) => a * x + b * y - c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const vp = val(p), vq = val(q);
    if (vp <= 1e-9) out.push(p);
    if ((vp < -1e-9 && vq > 1e-9) || (vp > 1e-9 && vq < -1e-9)) {
      const t = vp / (vp - vq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

function region(planes: HalfPlane[], box: [number, number, number, number]): Pt[] {
  const [x0, y0, x1, y1] = box;
  let poly: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (const hp of planes) if (Number.isFinite(hp[2])) poly = clip(poly, hp);
  return poly;
}

interface Model {
  p: Program;
  Z: ZoneLattice;
  zones: Map<string, Zone>;
  intervals: Map<string, Record<string, Interval> | null>;
  seen: Map<string, Record<string, number>[]>;
  points: Point[];
}

class ZonePlot extends HTMLElement {
  private exId = '';
  private point = '';
  private vx = '';
  private vy = '';
  private model!: Model;
  private bar!: HTMLElement;
  private plot!: HTMLElement;
  private code!: HTMLElement;
  private info!: HTMLElement;

  connectedCallback() {
    if (this.model) return;
    this.exId = this.dataset.example ?? 'two-counters';
    const ids = this.dataset.examples ? this.dataset.examples.split(',').map((x) => x.trim()) : [this.exId];
    const exSel = h('select', { 'aria-label': 'Example program' },
      ...ids.map((id) => { const o = h('option', { value: id }, example(id).title); o.selected = id === this.exId; return o; }));
    exSel.addEventListener('change', () => { this.exId = exSel.value; this.load(); });
    this.bar = h('div', { class: 'toolbar' });
    if (ids.length > 1) this.bar.append(exSel);
    this.plot = h('div', { class: 'plot' });
    this.code = h('pre', { class: 'code' });
    this.info = h('div', { class: 'info' });
    this.append(this.bar, h('div', { class: 'main' }, this.plot, this.code), this.info);
    this.load(this.dataset.line ? Number(this.dataset.line) : undefined, this.dataset.vars?.split(',').map((x) => x.trim()));
  }

  private load(line?: number, vars?: string[]) {
    const p = parse(example(this.exId).code);
    const Z = zoneStates(p.vars);
    const c = collect(p, { range: 3, maxRuns: 2000, fuel: 300 });
    this.model = {
      p, Z,
      zones: analyzeStates(p, Z).states,
      intervals: analyze(p, IntervalDomain).states,
      seen: c.states,
      points: programPoints(p),
    };
    const pts = this.model.points;
    const byLine = line !== undefined ? pts.filter((q) => q.line === line).at(-1) : undefined;
    const related = pts.find((q) => Z.relations(this.model.zones.get(q.key) ?? null).length > 0);
    this.point = (byLine ?? pts.find((q) => q.kind === 'head') ?? related ?? pts[0]).key;
    this.vx = vars?.[0] && p.vars.includes(vars[0]) ? vars[0] : p.vars[0];
    this.vy = vars?.[1] && p.vars.includes(vars[1]) ? vars[1] : p.vars.find((x) => x !== this.vx) ?? p.vars[0];
    this.render();
  }

  private render() {
    const { p, Z, zones, intervals, seen, points } = this.model;
    const pt = points.find((q) => q.key === this.point)!;

    // ---- toolbar: point and variables ----
    this.bar.querySelectorAll('.dyn').forEach((e) => e.remove());
    const src = example(this.exId).code.split('\n');
    const ptSel = h('select', { 'aria-label': 'Program point', class: 'dyn' },
      ...points.map((q) => {
        const where = q.kind === 'head' ? 'loop head' : q.kind === 'exit' ? 'after the block' : 'after';
        const o = h('option', { value: q.key }, `line ${q.line} (${where}): ${src[q.line - 1].trim().replace(/\s*\/\/.*$/, '')}`);
        o.selected = q.key === this.point;
        return o;
      }));
    ptSel.addEventListener('change', () => { this.point = ptSel.value; this.render(); });
    const varSel = (cur: string, label: string, set: (v: string) => void) => {
      const sel = h('select', { 'aria-label': label, class: 'var' },
        ...p.vars.map((x) => { const o = h('option', { value: x }, x); o.selected = x === cur; return o; }));
      sel.addEventListener('change', () => { set(sel.value); this.render(); });
      return sel;
    };
    this.bar.append(ptSel,
      h('label', { class: 'dyn' }, 'horizontal ', varSel(this.vx, 'Horizontal variable', (v) => (this.vx = v))),
      h('label', { class: 'dyn' }, 'vertical ', varSel(this.vy, 'Vertical variable', (v) => (this.vy = v))));

    // ---- code with the current line ----
    this.code.replaceChildren(...src.slice(0, src.at(-1) === '' ? -1 : undefined).map((text, i) => {
      const n = i + 1;
      const d = h('div', { class: n === pt.line ? 'cur' : '' }, h('span', { class: 'ln' }, String(n).padStart(2) + '  '), text);
      const target = points.filter((q) => q.line === n).at(-1);
      if (target) { d.classList.add('pick'); d.addEventListener('click', () => { this.point = target.key; this.render(); }); }
      return d;
    }));

    // ---- data at this point ----
    const zone = zones.get(this.point) ?? null;
    const m = Z.closed(zone);
    const ienv = intervals.get(this.point) ?? null;
    const ix = ienv ? ienv[this.vx] : null, iy = ienv ? ienv[this.vy] : null;
    const zx = Z.project(zone, this.vx), zy = Z.project(zone, this.vy);
    const dxy = Z.difference(zone, this.vx, this.vy); // vx − vy
    const pairs = new Map<string, Pt>();
    for (const env of seen.get(this.point) ?? []) pairs.set(`${env[this.vx]},${env[this.vy]}`, [env[this.vx], env[this.vy]]);
    const dots = [...pairs.values()];

    // ---- view window: around what tests saw, plus finite bounds that are close by ----
    const xs = dots.map((d) => d[0]), ys = dots.map((d) => d[1]);
    for (const v of [ix, zx]) if (v) xs.push(...[v.lo, v.hi].filter((b) => Number.isFinite(b) && Math.abs(b) <= 30));
    for (const v of [iy, zy]) if (v) ys.push(...[v.lo, v.hi].filter((b) => Number.isFinite(b) && Math.abs(b) <= 30));
    const span = (a: number[]) => (a.length ? [Math.min(...a), Math.max(...a)] : [-4, 4]);
    let [xlo, xhi] = span(xs), [ylo, yhi] = span(ys);
    let w = Math.max(xhi - xlo, yhi - ylo, 6) + 4;
    const cx = (xlo + xhi) / 2, cy = (ylo + yhi) / 2;
    xlo = Math.floor(cx - w / 2); xhi = xlo + Math.ceil(w); ylo = Math.floor(cy - w / 2); yhi = ylo + Math.ceil(w);
    w = xhi - xlo;

    const size = 300, pad = 28;
    const X = (x: number) => pad + ((x - xlo) / w) * size;
    const Y = (y: number) => pad + size - ((y - ylo) / w) * size;
    const svg = s('svg', { viewBox: `0 0 ${size + 2 * pad} ${size + 2 * pad}`, width: size + 2 * pad, height: size + 2 * pad, role: 'img',
      'aria-label': `Values of ${this.vx} and ${this.vy} at line ${pt.line}` });
    const g = s('g');
    const labels = s('g');
    svg.append(g, labels);
    // grid
    const step = w <= 16 ? 1 : w <= 40 ? 5 : 10;
    for (let v = Math.ceil(xlo / step) * step; v <= xhi; v += step) {
      g.append(s('line', { x1: X(v), x2: X(v), y1: Y(ylo), y2: Y(yhi), class: v === 0 ? 'axis' : 'grid' }));
      if (v % (step * (w > 16 ? 1 : 2)) === 0) labels.append(s('text', { x: X(v), y: Y(ylo) + 14, class: 'tick', 'text-anchor': 'middle' }, String(v)));
    }
    for (let v = Math.ceil(ylo / step) * step; v <= yhi; v += step) {
      g.append(s('line', { y1: Y(v), y2: Y(v), x1: X(xlo), x2: X(xhi), class: v === 0 ? 'axis' : 'grid' }));
      if (v % (step * (w > 16 ? 1 : 2)) === 0) labels.append(s('text', { x: X(xlo) - 5, y: Y(v) + 4, class: 'tick', 'text-anchor': 'end' }, String(v)));
    }
    labels.append(s('text', { x: X(xhi), y: Y(ylo) + 24, class: 'vname', 'text-anchor': 'end' }, `${this.vx} →`));
    labels.append(s('text', { x: X(xlo) - 4, y: pad - 10, class: 'vname', 'text-anchor': 'start' }, `↑ ${this.vy}`));

    const box: [number, number, number, number] = [xlo - 1, ylo - 1, xhi + 1, yhi + 1];
    const poly = (pts: Pt[], cls: string) => {
      if (!pts.length) return;
      g.append(s('polygon', { points: pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' '), class: cls }));
    };
    const boxPlanes = (a: Interval, b: Interval): HalfPlane[] =>
      a && b ? [[1, 0, a.hi], [-1, 0, -a.lo], [0, 1, b.hi], [0, -1, -b.lo]] : [];
    const clipPath = s('clipPath', { id: `zp-clip-${this.id || 'x'}` });
    clipPath.append(s('rect', { x: X(xlo), y: Y(yhi), width: size, height: size }));
    const defs = s('defs'); defs.append(clipPath); svg.prepend(defs);
    g.setAttribute('clip-path', `url(#zp-clip-${this.id || 'x'})`);
    if (ix && iy) poly(region(boxPlanes(ix, iy), box), 'ibox');
    if (m && zx && zy && dxy && this.vx !== this.vy) {
      poly(region([...boxPlanes(zx, zy), [1, -1, dxy.hi], [-1, 1, -dxy.lo]], box), 'zone');
    } else if (m && zx && zy) {
      poly(region(boxPlanes(zx, zy), box), 'zone');
    }
    for (const [x, y] of dots) g.append(s('circle', { cx: X(x), cy: Y(y), r: dots.length > 200 ? 2 : 3, class: 'dot' }));
    this.plot.replaceChildren(svg);

    // ---- legend and matrix ----
    const iv = (v: Interval) => showInterval(v);
    /** "x ∈ [0, 10]", or "x = 3" for a single value. */
    const is = (x: string, v: Interval) => `${x} ${v && v.lo === v.hi ? '=' : '∈'} ${iv(v)}`;
    const rel = Z.relations(zone);
    this.info.replaceChildren(
      h('p', { class: 'leg' }, h('span', { class: 'sw dot' }), h('span', {}, `States seen in tests (every input in −3..3): ${dots.length ? `${dots.length} distinct (${this.vx}, ${this.vy}) pairs` : 'none, this point is never reached'}`)),
      h('p', { class: 'leg' }, h('span', { class: 'sw ibox' }),
        h('span', {}, ienv ? `Intervals: ${is(this.vx, ix)}, ${is(this.vy, iy)}. A box: nothing links the two.` : 'Intervals: ⊥ (unreachable)')),
      h('p', { class: 'leg' }, h('span', { class: 'sw zone' }),
        h('span', {}, m ? `Zones: ${is(this.vx, zx)}, ${is(this.vy, zy)}, ${is(`${this.vx} − ${this.vy}`, dxy)}.` : 'Zones: ⊥ (unreachable)',
          m && rel.length ? h('span', { class: 'rel' }, ` Relations at this point: ${rel.join(', ')}.`) : '')),
      m ? this.matrix(m) : '',
    );
  }

  private matrix(m: number[][]) {
    const names = ['0', ...this.model.p.vars];
    const show = (v: number) => (v === Infinity ? '+∞' : v < 0 ? `−${-v}` : String(v));
    return h('details', {},
      h('summary', {}, 'The difference-bound matrix at this point (closed)'),
      h('p', { class: 'muted' }, 'Row i, column j holds the best c with  row − column ≤ c. The row and column “0” stand for the constant 0, so column 0 holds upper bounds and row 0 holds minus the lower bounds.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'dbm' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), ...names.map((x) => h('th', {}, x)))),
        h('tbody', {}, ...m.map((row, i) => h('tr', {}, h('th', {}, names[i]),
          ...row.map((v, j) => h('td', { class: i === j ? 'diag' : v === Infinity ? 'inf' : '' }, show(v)))))))));
  }
}

customElements.define('ai-zoneplot', ZonePlot);
