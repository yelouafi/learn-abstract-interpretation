import { describe, expect, it } from 'vitest';
import type { BinOp, CmpOp } from './ast';
import { parse } from './parser';
import { analyze } from './analyzer';
import { collect } from './collecting';
import { checkSoundness } from './soundness';
import { buildEquations, kleene } from './equations';
import { abstractStates } from './states';
import { EXAMPLES, example } from './examples';
import { IntervalDomain as I, type Interval, showInterval } from './domains/interval';
import { alphaOf } from './domains';

const INF = Infinity;
const ITVS: Interval[] = [
  null, { lo: 0, hi: 0 }, { lo: 1, hi: 1 }, { lo: -1, hi: -1 }, { lo: 2, hi: 7 }, { lo: -5, hi: -2 },
  { lo: -3, hi: 4 }, { lo: 0, hi: 10 }, { lo: -10, hi: 0 }, { lo: 0, hi: INF }, { lo: 1, hi: INF },
  { lo: -INF, hi: 0 }, { lo: -INF, hi: -1 }, { lo: 5, hi: INF }, { lo: -INF, hi: 3 }, { lo: -INF, hi: INF },
];
/** Some members of an interval: its finite bounds, nearby values, and large values for infinite bounds. */
function members(v: Interval): number[] {
  if (!v) return [];
  const out = new Set<number>();
  const lo = Number.isFinite(v.lo) ? v.lo : -1000, hi = Number.isFinite(v.hi) ? v.hi : 1000;
  for (const n of [lo, lo + 1, lo + 2, 0, 1, -1, 2, -2, 7, -7, hi - 2, hi - 1, hi, -999, 999]) {
    if (n >= v.lo && n <= v.hi && n >= lo && n <= hi) out.add(n);
  }
  return [...out];
}
const OPS: BinOp[] = ['+', '-', '*', '/'];
const CMPS: CmpOp[] = ['<', '<=', '>', '>=', '==', '!='];
const apply = (op: BinOp, x: number, y: number) =>
  op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : Math.trunc(x / y);
const holds = (op: CmpOp, x: number, y: number) =>
  op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : op === '>=' ? x >= y : op === '==' ? x === y : x !== y;

describe('interval domain', () => {
  it('is a lattice', () => {
    for (const a of ITVS) for (const b of ITVS) {
      const j = I.join(a, b), m = I.meet(a, b);
      expect(I.leq(a, j) && I.leq(b, j)).toBe(true);
      expect(I.leq(m, a) && I.leq(m, b)).toBe(true);
      for (const c of ITVS) {
        if (I.leq(a, c) && I.leq(b, c)) expect(I.leq(j, c)).toBe(true);
        if (I.leq(c, a) && I.leq(c, b)) expect(I.leq(c, m)).toBe(true);
      }
    }
  });

  it('forms a Galois connection on finite sets', () => {
    const SETS = [[], [0], [3, 7], [-1, -5], [0, 4], [-2, 0, 9], [5]];
    for (const S of SETS) for (const a of ITVS) {
      expect(I.leq(alphaOf(I, S), a)).toBe(S.every((n) => I.contains(a, n)));
    }
    expect(showInterval(alphaOf(I, [0, 10]))).toBe('[0, 10]'); // the hull: 1..9 are added
  });

  it('arithmetic is sound', () => {
    for (const a of ITVS) for (const b of ITVS) for (const op of OPS) {
      const r = I.binop(op, a, b);
      for (const x of members(a)) for (const y of members(b)) {
        if (op === '/' && y === 0) continue;
        expect(I.contains(r, apply(op, x, y)), `${showInterval(a)} ${op} ${showInterval(b)} ∌ ${x}${op}${y}`).toBe(true);
      }
    }
  });

  it('refinement is sound', () => {
    for (const a of ITVS) for (const b of ITVS) for (const op of CMPS) {
      const [a2, b2] = I.refine(op, a, b);
      for (const x of members(a)) for (const y of members(b)) {
        if (!holds(op, x, y)) continue;
        expect(I.contains(a2, x) && I.contains(b2, y), `${showInterval(a)} ${op} ${showInterval(b)} at ${x},${y}`).toBe(true);
      }
    }
  });

  it('computes the expected values', () => {
    const s = (v: Interval) => showInterval(v);
    expect(s(I.binop('+', { lo: 0, hi: 5 }, { lo: 1, hi: 1 }))).toBe('[1, 6]');
    expect(s(I.binop('*', { lo: -2, hi: 3 }, { lo: 4, hi: 5 }))).toBe('[−10, 15]');
    expect(s(I.binop('/', { lo: 1, hi: 10 }, { lo: 2, hi: 3 }))).toBe('[0, 5]');
    expect(s(I.binop('/', { lo: 1, hi: 1 }, { lo: 0, hi: 0 }))).toBe('⊥');
    expect(s(I.refine('<', { lo: -INF, hi: INF }, { lo: 10, hi: 10 })[0])).toBe('[−∞, 9]');
    expect(s(I.refine('!=', { lo: 0, hi: 10 }, { lo: 10, hi: 10 })[0])).toBe('[0, 9]');
    expect(s(I.widen!({ lo: 0, hi: 1 }, { lo: 0, hi: 2 }))).toBe('[0, +∞]');
    expect(s(I.narrow!({ lo: 0, hi: INF }, { lo: 0, hi: 100 }))).toBe('[0, 100]');
  });

  it('widening is an upper bound and narrowing stays between', () => {
    for (const a of ITVS) for (const b of ITVS) {
      const w = I.widen!(a, b);
      expect(I.leq(a, w) && I.leq(b, w)).toBe(true);
      if (I.leq(b, a)) {
        const n = I.narrow!(a, b);
        expect(I.leq(b, n) && I.leq(n, a), `${showInterval(a)} Δ ${showInterval(b)}`).toBe(true);
      }
    }
  });
});

describe('interval analysis', () => {
  it('is sound on every example, in both engines', () => {
    for (const ex of EXAMPLES) {
      const p = parse(ex.code);
      const c = collect(p, { range: 3, fuel: 300 });
      expect(checkSoundness(c, analyze(p, I), I), `${ex.id} structural`).toEqual([]);
      const L = abstractStates(I, p.vars);
      for (const strategy of ['jacobi', 'in-order'] as const) {
        const r = kleene(buildEquations(p, L), L, strategy, 200, { widenDelay: 2, narrowSteps: 3 });
        expect(r.stable, ex.id).toBe(true);
        const fake = { states: r.iterates.at(-1)!, asserts: new Map(), alarms: [], iterations: new Map(), iterationKinds: new Map() };
        expect(checkSoundness(c, fake, I), `${ex.id} ${strategy}`).toEqual([]);
      }
    }
  });

  const verdicts = (id: string, opts = {}) => [...analyze(parse(example(id).code), I, opts).asserts.values()];

  it('narrowing recovers the exit value of a counting loop', () => {
    expect(verdicts('count')).toEqual(['proved']);
    expect(verdicts('count', { narrowSteps: 0 })).toEqual(['unknown']);
    const a = analyze(parse(example('count').code), I);
    expect(showInterval(a.states.get('head:1')!.x)).toBe('[0, 100]');
    expect(a.iterationKinds.get(1)).toContain('widen');
    expect(a.iterationKinds.get(1)).toContain('narrow');
  });

  it('proves what signs could not, and still fails on relations', () => {
    expect(verdicts('countdown')).toEqual(['proved']);
    expect(verdicts('abs')).toEqual(['proved']);
    expect(verdicts('product')).toEqual(['proved']);
    expect(verdicts('copy')).toEqual(['unknown']);
    expect(verdicts('sum')).toEqual(['unknown', 'proved']); // i == n is relational
    expect(verdicts('not-equal')).toEqual(['proved']);
  });

  it('without widening, the Kleene solver climbs one step per round', () => {
    const p = parse(example('count').code);
    const L = abstractStates(I, p.vars);
    const eqs = buildEquations(p, L);
    const slow = kleene(eqs, L, 'in-order', 500, { widenDelay: null });
    expect(slow.stable).toBe(true);
    expect(slow.iterates.length).toBeGreaterThan(100);
    const fast = kleene(eqs, L, 'in-order', 500, { widenDelay: 1, narrowSteps: 3 });
    expect(fast.iterates.length).toBeLessThan(10);
    expect(showInterval(fast.iterates.at(-1)!.get('exit:1')!.x)).toBe('100');
    const p2 = parse(example('forever').code);
    const L2 = abstractStates(I, p2.vars);
    expect(kleene(buildEquations(p2, L2), L2, 'in-order', 300, { widenDelay: null }).stable).toBe(false);
  });
});
