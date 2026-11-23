// Zones: a relational domain that tracks bounds on differences  x − y ≤ c.
//
// A zone over variables x1..xn is stored as a *difference-bound matrix* (DBM):
//
//     m[i][j] = c    means    v_i − v_j ≤ c        (c may be +∞: no constraint)
//
// where v_0 is a special variable that is always 0, so that plain bounds fit
// the same shape:  x ≤ c  is  x − v_0 ≤ c,  and  x ≥ c  is  v_0 − x ≤ −c.
//
// The key operation is *closure*: making every implied constraint explicit.
// Constraints chain like path lengths (x − y ≤ a and y − z ≤ b give x − z ≤ a + b),
// so the tightest bounds are shortest paths in the graph whose edge i → j has
// weight m[i][j]: Floyd–Warshall. A negative cycle means the zone is empty.
//
// A zone is not a ValueDomain (one value per variable): it is a whole state, so it
// implements StateLattice directly and plugs into the analyzer and the solvers.

import { negate, type Cond, type Expr } from '../ast';
import type { Alarm, StateLattice } from '../states';
import { IntervalDomain, showInterval, type Interval } from './interval';

/** A difference-bound matrix, or null for the empty zone (⊥). Index 0 is the constant 0. */
export type Zone = number[][] | null;

const INF = Infinity;

const copy = (m: number[][]) => m.map((r) => r.slice());

/** Floyd–Warshall: tighten every bound to the shortest path. Returns null if a negative cycle exists. */
export function close(m: number[][]): Zone {
  const n = m.length;
  const r = copy(m);
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++) {
      const rik = r[i][k];
      if (rik === INF) continue;
      for (let j = 0; j < n; j++) {
        const s = rik + r[k][j];
        if (s < r[i][j]) r[i][j] = s;
      }
    }
  for (let i = 0; i < n; i++) {
    if (r[i][i] < 0) return null;
    r[i][i] = 0;
  }
  return r;
}

/** A linear expression  Σ coef·var + c. */
interface Linear { coef: Map<string, number>; c: number }

/** Linear form of e, or null if e is not linear (products of variables, division, input()). */
export function linearize(e: Expr): Linear | null {
  switch (e.kind) {
    case 'num': return { coef: new Map(), c: e.value };
    case 'var': return { coef: new Map([[e.name, 1]]), c: 0 };
    case 'input': return null;
    case 'neg': {
      const a = linearize(e.arg);
      return a && scale(a, -1);
    }
    case 'bin': {
      const a = linearize(e.left), b = linearize(e.right);
      if (!a || !b) return null;
      if (e.op === '+') return add(a, b);
      if (e.op === '-') return add(a, scale(b, -1));
      if (e.op === '*') {
        if (a.coef.size === 0) return scale(b, a.c);
        if (b.coef.size === 0) return scale(a, b.c);
      }
      return null;
    }
  }
}

function scale(a: Linear, k: number): Linear {
  const coef = new Map<string, number>();
  for (const [x, v] of a.coef) if (v * k !== 0) coef.set(x, v * k);
  return { coef, c: a.c * k };
}

function add(a: Linear, b: Linear): Linear {
  const coef = new Map(a.coef);
  for (const [x, v] of b.coef) {
    const s = (coef.get(x) ?? 0) + v;
    if (s === 0) coef.delete(x); else coef.set(x, s);
  }
  return { coef, c: a.c + b.c };
}

/**
 * The zone shape of a linear form:  v_plus − v_minus + c,  where each of the two
 * variables may be absent (index 0). null if the form needs other coefficients
 * (x + y, 2·x, ...): zones cannot express it.
 */
function zoneShape(l: Linear, index: Map<string, number>): { plus: number; minus: number; c: number } | null {
  let plus = 0, minus = 0;
  for (const [x, k] of l.coef) {
    if (k === 1 && plus === 0) plus = index.get(x)!;
    else if (k === -1 && minus === 0) minus = index.get(x)!;
    else return null;
  }
  return { plus, minus, c: l.c };
}

export interface ZoneLattice extends StateLattice<Zone> {
  vars: string[];
  /** The interval of one variable: what a non-relational analysis would see. */
  project(s: Zone, x: string): Interval;
  /** Tightest bounds on  x − y. */
  difference(s: Zone, x: string, y: string): Interval;
  /** The constraints between pairs of variables that the intervals alone do not imply. */
  relations(s: Zone): string[];
  /** Does a concrete environment satisfy every constraint? (for soundness tests) */
  contains(s: Zone, env: Record<string, number>): boolean;
  show(s: Zone): string;
  /** The closed DBM (for display). */
  closed(s: Zone): Zone;
}

export function zoneStates(vars: string[]): ZoneLattice {
  const n = vars.length + 1;
  const index = new Map(vars.map((x, i) => [x, i + 1]));
  const top = (): number[][] => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : INF)));

  const closed = (s: Zone): Zone => (s ? close(s) : null);

  /** Remove every constraint on variable i (the zone must be closed so that nothing implied is lost). */
  const forget = (m: number[][], i: number) => {
    for (let j = 0; j < n; j++) if (j !== i) { m[i][j] = INF; m[j][i] = INF; }
  };

  const bound = (m: number[][], i: number, j: number): Interval => {
    // v_i − v_j ∈ [−m[j][i], m[i][j]]
    const lo = -m[j][i], hi = m[i][j];
    return lo > hi ? null : { lo, hi };
  };

  /** Interval of an expression, using the zone for difference-shaped parts (so  x − y  gets its exact bound). */
  const evalI = (e: Expr, m: number[][], report?: Alarm[], stmtId = -1): Interval => {
    const l = linearize(e);
    const z = l && zoneShape(l, index);
    if (z) {
      const b = bound(m, z.plus, z.minus);
      return b && { lo: b.lo + z.c, hi: b.hi + z.c };
    }
    switch (e.kind) {
      case 'num': return IntervalDomain.fromConst(e.value);
      case 'var': return bound(m, index.get(e.name)!, 0);
      case 'input': return IntervalDomain.top;
      case 'neg': return IntervalDomain.neg(evalI(e.arg, m, report, stmtId));
      case 'bin': {
        const a = evalI(e.left, m, report, stmtId);
        const b = evalI(e.right, m, report, stmtId);
        if (report && e.op === '/' && IntervalDomain.contains(b, 0) && a) {
          const sure = b!.lo === 0 && b!.hi === 0;
          report.push({ line: e.line, stmtId, severity: sure ? 'error' : 'warning', message: sure ? 'division by zero' : 'possible division by zero' });
        }
        return IntervalDomain.binop(e.op, a, b);
      }
    }
  };

  /** Add  v_i − v_j ≤ c. */
  const addLe = (m: number[][], i: number, j: number, c: number) => {
    if (c < m[i][j]) m[i][j] = c;
  };

  /** Set variable i to an interval, forgetting its relations. */
  const setInterval = (m: number[][], i: number, v: Interval): Zone => {
    if (!v) return null;
    forget(m, i);
    if (v.hi !== INF) m[i][0] = v.hi;
    if (v.lo !== -INF) m[0][i] = -v.lo;
    return close(m);
  };

  /** Keep the states where  t ≤ 0, for a zone-shaped t. */
  const leZero = (m: number[][], t: { plus: number; minus: number; c: number }) => {
    // v_plus − v_minus + c ≤ 0   ⇔   v_plus − v_minus ≤ −c
    if (t.plus === t.minus) { if (t.c > 0) m[0][0] = -1; return; } // constant test: −1 on the diagonal marks ⊥
    addLe(m, t.plus, t.minus, -t.c);
  };
  const flip = (t: { plus: number; minus: number; c: number }) => ({ plus: t.minus, minus: t.plus, c: -t.c });

  /** Non-relational fallback for tests zones cannot express: refine bare variables with intervals. */
  const filterIntervals = (m: number[][], c: Extract<Cond, { kind: 'cmp' }>): Zone => {
    const a = evalI(c.left, m), b = evalI(c.right, m);
    const [a2, b2] = IntervalDomain.refine(c.op, a, b);
    if (!a2 || !b2) return null;
    for (const [side, v] of [[c.left, a2], [c.right, b2]] as const) {
      if (side.kind !== 'var') continue;
      const i = index.get(side.name)!;
      if (v.hi !== INF) addLe(m, i, 0, v.hi);
      if (v.lo !== -INF) addLe(m, 0, i, -v.lo);
    }
    return close(m);
  };

  const L: ZoneLattice = {
    vars,
    bottom: null,
    init: Array.from({ length: n }, () => Array.from({ length: n }, () => 0)),
    isBottom: (s) => s === null || close(s) === null,
    leq(a, b) {
      const ca = closed(a);
      if (!ca) return true;
      if (!b) return false;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (ca[i][j] > b[i][j]) return false;
      return true;
    },
    join(a, b) {
      const ca = closed(a), cb = closed(b);
      if (!ca) return cb;
      if (!cb) return ca;
      return ca.map((r, i) => r.map((v, j) => Math.max(v, cb[i][j])));
    },
    // Keep the bounds that held still; drop the others to +∞. The result is NOT closed on
    // purpose: closing it could bring a dropped bound back and break termination.
    widen(a, b) {
      if (!a) return closed(b);
      const cb = closed(b);
      if (!cb) return a;
      return a.map((r, i) => r.map((v, j) => (cb[i][j] <= v ? v : INF)));
    },
    narrow(a, b) {
      if (!a || !b) return null;
      return close(a.map((r, i) => r.map((v, j) => (v === INF ? b[i][j] : v))));
    },
    assign(s, x, e, report, stmtId) {
      const m0 = closed(s);
      if (!m0) return null;
      const m = copy(m0);
      const i = index.get(x)!;
      const l = linearize(e);
      const z = l && zoneShape(l, index);
      if (z && z.minus === 0) {
        if (z.plus === i) {
          // x = x + c: shift every bound involving x. Exact, and stays closed.
          for (let j = 0; j < n; j++) if (j !== i) {
            if (m[i][j] !== INF) m[i][j] += z.c;
            if (m[j][i] !== INF) m[j][i] -= z.c;
          }
          return m;
        }
        // x = y + c  (or x = c when plus is 0): forget x, then record  x − y = c.
        forget(m, i);
        m[i][z.plus] = z.c;
        m[z.plus][i] = -z.c;
        return close(m);
      }
      // Anything else: evaluate e to an interval (using the zone) and forget the relations of x.
      return setInterval(m, i, evalI(e, m0, report, stmtId));
    },
    filter(s, c) {
      const m0 = closed(s);
      if (!m0) return null;
      switch (c.kind) {
        case 'bool': return c.value ? m0 : null;
        case 'not': return L.filter(m0, negate(c.arg));
        case 'and': return L.filter(L.filter(m0, c.left), c.right);
        case 'or': return L.join(L.filter(m0, c.left), L.filter(m0, c.right));
        case 'cmp': {
          const m = copy(m0);
          const l = linearize({ kind: 'bin', op: '-', left: c.left, right: c.right, line: 0 });
          const t = l && zoneShape(l, index);
          if (!t) return filterIntervals(m, c);
          // t = left − right; the test is  t op 0. Integers: t < 0 is t + 1 ≤ 0.
          switch (c.op) {
            case '<=': leZero(m, t); break;
            case '<': leZero(m, { ...t, c: t.c + 1 }); break;
            case '>=': leZero(m, flip(t)); break;
            case '>': leZero(m, { ...flip(t), c: -t.c + 1 }); break;
            case '==': leZero(m, t); leZero(m, flip(t)); break;
            case '!=': {
              // Like intervals: we can only trim an endpoint of t's range.
              const b = bound(m, t.plus, t.minus);
              if (!b) return null;
              const lo = b.lo + t.c, hi = b.hi + t.c;
              if (lo === 0 && hi === 0) return null;
              if (lo === 0) leZero(m, { ...flip(t), c: -t.c + 1 });
              else if (hi === 0) leZero(m, { ...t, c: t.c + 1 });
              break;
            }
          }
          return close(m);
        }
      }
    },
    showVar: (s, x) => {
      const m = closed(s);
      return m ? showInterval(bound(m, index.get(x)!, 0)) : '⊥';
    },
    project(s, x) {
      const m = closed(s);
      return m && bound(m, index.get(x)!, 0);
    },
    difference(s, x, y) {
      const m = closed(s);
      return m && bound(m, index.get(x)!, index.get(y)!);
    },
    relations(s) {
      const m = closed(s);
      if (!m) return [];
      const out: string[] = [];
      for (let a = 1; a < n; a++) for (let b = a + 1; b < n; b++) {
        // Describe the later variable (b) relative to the earlier one (a):  v_b − v_a ∈ [lo, hi].
        const hi = m[b][a], lo = -m[a][b];
        // What the two intervals alone would give for v_b − v_a:
        const implHi = m[b][0] + m[0][a], implLo = -(m[a][0] + m[0][b]);
        const useHi = hi < implHi, useLo = lo > implLo;
        if (!useHi && !useLo) continue;
        const X = vars[b - 1], Y = vars[a - 1];
        const plus = (k: number) => (k === 0 ? Y : k > 0 ? `${Y} + ${k}` : `${Y} − ${-k}`);
        if (lo === hi) out.push(`${X} = ${plus(lo)}`);
        else if (useHi && useLo) out.push(`${plus(lo)} ≤ ${X} ≤ ${plus(hi)}`);
        else if (useHi) out.push(hi === -1 ? `${X} < ${Y}` : `${X} ≤ ${plus(hi)}`);
        else out.push(lo === 1 ? `${X} > ${Y}` : `${X} ≥ ${plus(lo)}`);
      }
      return out;
    },
    contains(s, env) {
      const m = closed(s);
      if (!m) return false;
      const v = (i: number) => (i === 0 ? 0 : env[vars[i - 1]]);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (v(i) - v(j) > m[i][j]) return false;
      return true;
    },
    show(s) {
      const m = closed(s);
      if (!m) return '⊥ unreachable';
      const vals = vars.map((x) => `${x}: ${L.showVar(m, x)}`).join('   ');
      const rel = L.relations(m);
      return rel.length ? `${vals}   │ ${rel.join(', ')}` : vals;
    },
    closed,
  };
  return L;
}
