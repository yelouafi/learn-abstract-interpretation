// Extended signs: every collection of basic signs is an abstract value.
//
//              ⊤
//          /   |   \
//       ≤0    ≠0    ≥0
//        | \ /  \ / |
//        |  X    X  |
//        | / \  / \ |
//        −     0     +
//          \   |   /
//              ⊥
//
// Think of an abstract value as a SET of basic signs: ≥0 is {zero, pos}, ≠0 is {neg, pos}.
// Then ⊑ is "subset of", join is union and meet is intersection. Compared with the
// 5-element domain nothing else changes: the case-by-case operators are the same, but
// summarize() no longer rounds a two-sign collection up to ⊤. It keeps it as is.
//
// Implementation detail: the set is stored as a 3-bit mask (neg = 1, zero = 2, pos = 4),
// so union is |, intersection is &, and "a ⊆ b" is (a & ~b) === 0.

import type { ValueDomain } from '../domain';
import { BASIC_SIGNS, negSign, possibleSigns, canBeTrue, signOf, type BasicSign } from './sign';

export type Sign8 = number; // 0..7

const BIT: Record<BasicSign, number> = { neg: 1, zero: 2, pos: 4 };

/** The basic signs an abstract value covers. */
export function cases8(v: Sign8): BasicSign[] {
  return BASIC_SIGNS.filter((a) => v & BIT[a]);
}

/** Summarize a collection of basic signs: just the set itself, no rounding. */
export function summarize8(signs: Iterable<BasicSign>): Sign8 {
  let v = 0;
  for (const a of signs) v |= BIT[a];
  return v;
}

const NAMES = ['⊥', '−', '0', '≤0', '+', '≠0', '≥0', '⊤'];

export const Signs8Domain: ValueDomain<Sign8> = {
  name: 'Extended signs',
  bottom: 0,
  top: 7,

  leq: (a, b) => (a & ~b) === 0,
  join: (a, b) => a | b,
  meet: (a, b) => a & b,

  fromConst: (n) => BIT[signOf(n)],
  contains: (v, n) => (v & BIT[signOf(n)]) !== 0,

  binop(op, a, b) {
    const results: BasicSign[] = [];
    for (const x of cases8(a)) for (const y of cases8(b)) results.push(...possibleSigns(op, x, y));
    return summarize8(results);
  },
  neg: (a) => summarize8(cases8(a).map(negSign)),

  refine(op, a, b) {
    const keepA: BasicSign[] = [], keepB: BasicSign[] = [];
    for (const x of cases8(a)) for (const y of cases8(b)) {
      if (canBeTrue(op, x, y)) { keepA.push(x); keepB.push(y); }
    }
    return [summarize8(keepA), summarize8(keepB)];
  },

  show: (v) => NAMES[v],
};

export const SIGNS8_LATTICE = {
  elements: [0, 1, 2, 4, 3, 5, 6, 7] as Sign8[],
  covers: [
    [0, 1], [0, 2], [0, 4],
    [1, 3], [2, 3], [1, 5], [4, 5], [2, 6], [4, 6],
    [3, 7], [5, 7], [6, 7],
  ] as [Sign8, Sign8][],
  describe: {
    0: 'no value (unreachable)',
    1: 'some negative integer',
    2: 'exactly 0',
    4: 'some positive integer',
    3: 'negative or zero',
    5: 'any integer except 0',
    6: 'zero or positive',
    7: 'any integer',
  } as Record<number, string>,
};
