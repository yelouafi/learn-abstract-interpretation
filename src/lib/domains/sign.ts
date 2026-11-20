// The sign domain:
//
//            ⊤          any integer
//          / | \
//         −  0  +       negative, zero, positive
//          \ | /
//            ⊥          no integer at all
//
// Everything here is built by SPLITTING INTO CASES. Every integer is negative, zero or
// positive: these are the three *basic signs*. An abstract value covers some of them:
//
//     ⊥ covers none,   − covers {neg},   0 covers {zero},   + covers {pos},   ⊤ covers all three
//
// To compute a + b: list the cases a covers and the cases b covers, work out which signs
// the result can have in each combination, collect them all, and summarize the collection
// as one abstract value. This lattice can only name collections of size 0, 1 or 3, so a
// collection like {zero, pos} is summarized as ⊤. That rounding is where precision is lost.

import type { BinOp, CmpOp } from '../ast';
import type { ValueDomain } from '../domain';

export type Sign = 'bot' | 'neg' | 'zero' | 'pos' | 'top';
export type BasicSign = 'neg' | 'zero' | 'pos';

export const BASIC_SIGNS: BasicSign[] = ['neg', 'zero', 'pos'];

/** The basic signs an abstract value covers. */
export function cases(s: Sign): BasicSign[] {
  switch (s) {
    case 'bot': return [];
    case 'top': return BASIC_SIGNS;
    default: return [s];
  }
}

/** The most precise abstract value covering a collection of basic signs. */
export function summarize(signs: Iterable<BasicSign>): Sign {
  const set = new Set(signs);
  if (set.size === 0) return 'bot';
  if (set.size === 1) return [...set][0];
  return 'top'; // two or three different signs: only ⊤ covers them
}

export function signOf(n: number): BasicSign {
  return n < 0 ? 'neg' : n === 0 ? 'zero' : 'pos';
}

/** α on a set of integers. */
export function alphaSign(ns: Iterable<number>): Sign {
  return summarize([...ns].map(signOf));
}

// ---- one case at a time ----------------------------------------------------------
// "If x has basic sign a and y has basic sign b, which signs can x op y have?"
// These are facts about ordinary arithmetic that you can check with examples.

function plusSigns(a: BasicSign, b: BasicSign): BasicSign[] {
  if (a === 'zero') return [b];                // 0 + y has the sign of y
  if (b === 'zero') return [a];
  if (a === b) return [a];                     // 2 + 3 > 0,  -2 + -3 < 0
  return BASIC_SIGNS;                          // 5 + -3 = 2,  3 + -3 = 0,  3 + -5 = -2
}

function timesSigns(a: BasicSign, b: BasicSign): BasicSign[] {
  if (a === 'zero' || b === 'zero') return ['zero'];
  return [a === b ? 'pos' : 'neg'];            // the rule of signs
}

export function negSign(a: BasicSign): BasicSign {
  return a === 'neg' ? 'pos' : a === 'pos' ? 'neg' : 'zero';
}

function divSigns(a: BasicSign, b: BasicSign): BasicSign[] {
  if (b === 'zero') return [];                 // crash: no result at all
  if (a === 'zero') return ['zero'];
  return ['zero', a === b ? 'pos' : 'neg'];    // division truncates: 1 / 2 = 0, 5 / 2 = 2
}

/** Which signs can x op y have, when x has basic sign a and y has basic sign b? */
export function possibleSigns(op: BinOp, a: BasicSign, b: BasicSign): BasicSign[] {
  switch (op) {
    case '+': return plusSigns(a, b);
    case '-': return plusSigns(a, negSign(b));  // x - y = x + (-y)
    case '*': return timesSigns(a, b);
    case '/': return divSigns(a, b);
  }
}

// The smallest and largest integer of each basic sign.
const SMALLEST: Record<BasicSign, number> = { neg: -Infinity, zero: 0, pos: 1 };
const LARGEST: Record<BasicSign, number> = { neg: -1, zero: 0, pos: Infinity };

/**
 * Can `x op y` be true for SOME x with basic sign a and SOME y with basic sign b?
 * For example, "x < y" is possible exactly when the smallest x is below the largest y.
 */
export function canBeTrue(op: CmpOp, a: BasicSign, b: BasicSign): boolean {
  switch (op) {
    case '<': return SMALLEST[a] < LARGEST[b];
    case '<=': return SMALLEST[a] <= LARGEST[b];
    case '>': return LARGEST[a] > SMALLEST[b];
    case '>=': return LARGEST[a] >= SMALLEST[b];
    case '==': return a === b;                  // equal numbers have the same sign
    case '!=': return !(a === 'zero' && b === 'zero'); // only 0 != 0 is impossible
  }
}

/** A few integers of each basic sign, for examples and witnesses. */
export const SAMPLES: Record<BasicSign, number[]> = {
  neg: [-1, -2, -3, -5],
  zero: [0],
  pos: [1, 2, 3, 5],
};

const RANK: Record<Sign, number> = { bot: 0, neg: 1, zero: 1, pos: 1, top: 2 };

export const SignDomain: ValueDomain<Sign> = {
  name: 'Signs',
  bottom: 'bot',
  top: 'top',

  leq: (a, b) => a === b || a === 'bot' || b === 'top',
  join: (a, b) => (a === b ? a : a === 'bot' ? b : b === 'bot' ? a : 'top'),
  meet: (a, b) => (a === b ? a : a === 'top' ? b : b === 'top' ? a : 'bot'),

  fromConst: (n) => signOf(n),
  contains: (v, n) => cases(v).includes(signOf(n)),

  // Split into cases, compute each case, summarize. (This is the best operator α ∘ op ∘ γ.)
  binop(op, a, b) {
    const results: BasicSign[] = [];
    for (const x of cases(a)) for (const y of cases(b)) results.push(...possibleSigns(op, x, y));
    return summarize(results);
  },
  neg: (a) => summarize(cases(a).map(negSign)),

  // Keep, on each side, only the cases that can make the comparison true.
  refine(op, a, b) {
    const keepA: BasicSign[] = [], keepB: BasicSign[] = [];
    for (const x of cases(a)) for (const y of cases(b)) {
      if (canBeTrue(op, x, y)) { keepA.push(x); keepB.push(y); }
    }
    return [summarize(keepA), summarize(keepB)];
  },

  show: (v) => ({ bot: '⊥', neg: '−', zero: '0', pos: '+', top: '⊤' })[v],
};

/** Lattice structure, for drawing Hasse diagrams. */
export const SIGN_LATTICE = {
  elements: ['bot', 'neg', 'zero', 'pos', 'top'] as Sign[],
  rank: RANK,
  covers: [
    ['bot', 'neg'], ['bot', 'zero'], ['bot', 'pos'],
    ['neg', 'top'], ['zero', 'top'], ['pos', 'top'],
  ] as [Sign, Sign][],
  describe: {
    bot: 'no value (unreachable)',
    neg: 'some negative integer',
    zero: 'exactly 0',
    pos: 'some positive integer',
    top: 'any integer',
  } as Record<Sign, string>,
};
