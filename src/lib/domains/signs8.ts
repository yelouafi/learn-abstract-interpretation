// Extended signs: every set of atoms is an abstract value.
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
// An abstract value is a 3-bit mask over the atoms (neg = 1, zero = 2, pos = 4), so the
// lattice is exactly the powerset of {−, 0, +}: join is bitwise OR, meet is bitwise AND,
// and ⊑ is "is a subset of". Compared with the 5-element domain nothing else changes:
// the operators on atoms are the same, but α no longer has to round two-atom sets up to ⊤.

import type { ValueDomain } from '../domain';
import { ATOMS, atomNeg, atomOp, cmpPossible, signOf, type Atom } from './sign';

export type Sign8 = number; // 0..7

const BIT: Record<Atom, number> = { neg: 1, zero: 2, pos: 4 };

export function atoms8(v: Sign8): Atom[] {
  return ATOMS.filter((a) => v & BIT[a]);
}

/** α on sets of atoms: just the set itself, no rounding. */
export function fromAtoms8(as: Iterable<Atom>): Sign8 {
  let v = 0;
  for (const a of as) v |= BIT[a];
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
    const out: Atom[] = [];
    for (const x of atoms8(a)) for (const y of atoms8(b)) out.push(...atomOp(op, x, y));
    return fromAtoms8(out);
  },
  neg: (a) => fromAtoms8(atoms8(a).map(atomNeg)),

  refine(op, a, b) {
    const ka: Atom[] = [], kb: Atom[] = [];
    for (const x of atoms8(a)) for (const y of atoms8(b)) {
      if (cmpPossible(op, x, y)) { ka.push(x); kb.push(y); }
    }
    return [fromAtoms8(ka), fromAtoms8(kb)];
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
