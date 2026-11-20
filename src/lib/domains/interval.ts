// The interval domain: a set of integers is summarized by its smallest and largest element.
//
//   [2, 7]      every integer from 2 to 7
//   [0, +∞]     every integer ≥ 0
//   [−∞, +∞]    any integer (⊤)
//   ⊥           no integer at all
//
// Unlike signs, intervals can COUNT: after `x = 0; while (x < 10) x = x + 1;` they can say
// that x is exactly 10. The price is an infinite lattice: [0,0] ⊑ [0,1] ⊑ [0,2] ⊑ … never
// ends, so loop iteration may not terminate. Widening (below) fixes that.

import type { BinOp, CmpOp } from '../ast';
import type { ValueDomain } from '../domain';

/** null is ⊥; otherwise lo ≤ hi, and the bounds may be ±Infinity. */
export type Interval = { lo: number; hi: number } | null;

const itv = (lo: number, hi: number): Interval => (lo > hi ? null : { lo, hi });

export const TOP: Interval = { lo: -Infinity, hi: Infinity };

// ---- arithmetic on bounds, where a bound may be infinite ---------------------------

/** a · b with the convention 0 · ∞ = 0 (a bound that is 0 really means 0). */
function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return a * b;
}

/** Truncating division of bounds. Only called with b ≠ 0. */
function div(a: number, b: number): number {
  if (!Number.isFinite(b)) {
    if (!Number.isFinite(a)) return Math.sign(a) * Math.sign(b) * Infinity; // ∞/∞: the extreme case
    return 0; // finite / ∞ → 0
  }
  if (!Number.isFinite(a)) return Math.sign(a) * Math.sign(b) * Infinity;
  return Math.trunc(a / b);
}

const range = (xs: number[]): Interval => itv(Math.min(...xs), Math.max(...xs));

/** x / y for y in [c, d], where the divisor interval does not contain 0. */
function divNoZero(a: { lo: number; hi: number }, c: number, d: number): Interval {
  // Truncation is monotone, so the extremes of trunc(x / y) are at the corners.
  return range([div(a.lo, c), div(a.lo, d), div(a.hi, c), div(a.hi, d)]);
}

function join(a: Interval, b: Interval): Interval {
  if (!a) return b;
  if (!b) return a;
  return { lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
}

function meet(a: Interval, b: Interval): Interval {
  if (!a || !b) return null;
  return itv(Math.max(a.lo, b.lo), Math.min(a.hi, b.hi));
}

function binop(op: BinOp, a: Interval, b: Interval): Interval {
  if (!a || !b) return null;
  switch (op) {
    case '+': return itv(a.lo + b.lo, a.hi + b.hi);
    case '-': return itv(a.lo - b.hi, a.hi - b.lo);
    case '*': return range([mul(a.lo, b.lo), mul(a.lo, b.hi), mul(a.hi, b.lo), mul(a.hi, b.hi)]);
    case '/': {
      // Split the divisor into its negative and positive parts; dividing by 0 has no result.
      const neg = meet(b, { lo: -Infinity, hi: -1 });
      const pos = meet(b, { lo: 1, hi: Infinity });
      return join(neg && divNoZero(a, neg.lo, neg.hi), pos && divNoZero(a, pos.lo, pos.hi));
    }
  }
}

/** The parts of a and b for which `x op y` can hold. */
function refine(op: CmpOp, a: Interval, b: Interval): [Interval, Interval] {
  if (!a || !b) return [null, null];
  switch (op) {
    // x < y: x is at most (largest y) − 1, and y is at least (smallest x) + 1.
    case '<': return [meet(a, { lo: -Infinity, hi: b.hi - 1 }), meet(b, { lo: a.lo + 1, hi: Infinity })];
    case '<=': return [meet(a, { lo: -Infinity, hi: b.hi }), meet(b, { lo: a.lo, hi: Infinity })];
    case '>': { const [y, x] = refine('<', b, a); return [x, y]; }
    case '>=': { const [y, x] = refine('<=', b, a); return [x, y]; }
    case '==': { const m = meet(a, b); return [m, m]; }
    case '!=': {
      // Intervals cannot have holes; we can only cut an endpoint equal to a constant.
      const cut = (x: Interval, y: Interval): Interval => {
        if (!x || !y || y.lo !== y.hi) return x;
        if (x.lo === y.lo && x.hi === y.lo) return null;
        if (x.lo === y.lo) return itv(x.lo + 1, x.hi);
        if (x.hi === y.lo) return itv(x.lo, x.hi - 1);
        return x;
      };
      const a2 = cut(a, b), b2 = cut(b, a);
      return a2 && b2 ? [a2, b2] : [null, null];
    }
  }
}

const fmt = (n: number) => (n === Infinity ? '+∞' : n === -Infinity ? '−∞' : n < 0 ? `−${-n}` : String(n));

export function showInterval(v: Interval): string {
  if (!v) return '⊥';
  if (v.lo === -Infinity && v.hi === Infinity) return '⊤';
  if (v.lo === v.hi) return fmt(v.lo);
  return `[${fmt(v.lo)}, ${fmt(v.hi)}]`;
}

export const IntervalDomain: ValueDomain<Interval> = {
  name: 'Intervals',
  bottom: null,
  top: TOP,

  leq: (a, b) => !a || (!!b && b.lo <= a.lo && a.hi <= b.hi),
  join,
  meet,

  // Widening: a bound that is still moving jumps straight to infinity.
  //   [0, 1] ∇ [0, 2] = [0, +∞]        [0, 5] ∇ [−1, 5] = [−∞, 5]
  widen(a, b) {
    if (!a) return b;
    if (!b) return a;
    return { lo: b.lo < a.lo ? -Infinity : a.lo, hi: b.hi > a.hi ? Infinity : a.hi };
  },

  // Narrowing: only infinite bounds may be replaced by finite ones.
  //   [0, +∞] Δ [0, 10] = [0, 10]      [0, 20] Δ [0, 10] = [0, 20]
  narrow(a, b) {
    if (!a || !b) return null;
    return { lo: a.lo === -Infinity ? b.lo : a.lo, hi: a.hi === Infinity ? b.hi : a.hi };
  },

  fromConst: (n) => ({ lo: n, hi: n }),
  contains: (v, n) => !!v && v.lo <= n && n <= v.hi,

  binop,
  neg: (a) => (a ? { lo: -a.hi, hi: -a.lo } : null),
  refine,
  show: showInterval,
};
