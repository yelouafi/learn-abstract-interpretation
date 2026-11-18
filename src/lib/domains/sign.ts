// The sign domain:
//
//            ⊤          any integer
//          / | \
//         −  0  +       negative, zero, positive
//          \ | /
//            ⊥          no integer at all
//
// We build every operation from three "atoms" (neg, zero, pos), which partition the
// integers. An abstract value is just a set of atoms, except that this lattice can only
// represent sets of size 0, 1 or 3: a two-atom set like {zero, pos} gets rounded up
// to ⊤. That rounding is where the domain loses precision.

import type { BinOp, CmpOp } from '../ast';
import type { ValueDomain } from '../domain';

export type Sign = 'bot' | 'neg' | 'zero' | 'pos' | 'top';
export type Atom = 'neg' | 'zero' | 'pos';

export const ATOMS: Atom[] = ['neg', 'zero', 'pos'];

/** γ restricted to atoms: which atoms does a sign stand for? */
export function atoms(s: Sign): Atom[] {
  switch (s) {
    case 'bot': return [];
    case 'top': return ATOMS;
    default: return [s];
  }
}

/** α on sets of atoms: the most precise sign covering them. */
export function fromAtoms(as: Iterable<Atom>): Sign {
  const set = new Set(as);
  if (set.size === 0) return 'bot';
  if (set.size === 1) return [...set][0];
  return 'top';
}

export function signOf(n: number): Atom {
  return n < 0 ? 'neg' : n === 0 ? 'zero' : 'pos';
}

/** α on a set of integers. */
export function alphaSign(ns: Iterable<number>): Sign {
  return fromAtoms([...ns].map(signOf));
}

// ---- concrete behaviour of the operators on atoms -------------------------------
// Each entry answers: "if a has this sign and b has that sign, which signs can a op b have?"

function atomPlus(a: Atom, b: Atom): Atom[] {
  if (a === 'zero') return [b];
  if (b === 'zero') return [a];
  if (a === b) return [a];
  return ATOMS; // e.g. 5 + (-3) = 2, 3 + (-3) = 0, 3 + (-5) = -2
}

function atomTimes(a: Atom, b: Atom): Atom[] {
  if (a === 'zero' || b === 'zero') return ['zero'];
  return [a === b ? 'pos' : 'neg'];
}

function atomNeg(a: Atom): Atom {
  return a === 'neg' ? 'pos' : a === 'pos' ? 'neg' : 'zero';
}

function atomDiv(a: Atom, b: Atom): Atom[] {
  if (b === 'zero') return []; // runtime error: no result value
  if (a === 'zero') return ['zero'];
  // truncating division: 1 / 2 = 0, so the result may be zero
  return ['zero', a === b ? 'pos' : 'neg'];
}

function atomOp(op: BinOp, a: Atom, b: Atom): Atom[] {
  switch (op) {
    case '+': return atomPlus(a, b);
    case '-': return atomPlus(a, atomNeg(b));
    case '*': return atomTimes(a, b);
    case '/': return atomDiv(a, b);
  }
}

// Each atom as an integer range, to decide comparisons.
const RANGE: Record<Atom, [number, number]> = {
  neg: [-Infinity, -1],
  zero: [0, 0],
  pos: [1, Infinity],
};

/** Can `x op y` hold for some x in atom a and some y in atom b? */
export function cmpPossible(op: CmpOp, a: Atom, b: Atom): boolean {
  const [a1, a2] = RANGE[a];
  const [b1, b2] = RANGE[b];
  switch (op) {
    case '<': return a1 < b2;
    case '<=': return a1 <= b2;
    case '>': return a2 > b1;
    case '>=': return a2 >= b1;
    case '==': return a1 <= b2 && b1 <= a2;
    case '!=': return !(a1 === a2 && b1 === b2 && a1 === b1);
  }
}

const RANK: Record<Sign, number> = { bot: 0, neg: 1, zero: 1, pos: 1, top: 2 };

export const SignDomain: ValueDomain<Sign> = {
  name: 'Signs',
  bottom: 'bot',
  top: 'top',

  leq: (a, b) => a === b || a === 'bot' || b === 'top',
  join: (a, b) => (a === b ? a : a === 'bot' ? b : b === 'bot' ? a : 'top'),
  meet: (a, b) => (a === b ? a : a === 'top' ? b : b === 'top' ? a : 'bot'),

  fromConst: (n) => signOf(n),
  contains: (v, n) => atoms(v).includes(signOf(n)),

  // The best abstract operator: α ∘ op ∘ γ, computed atom by atom.
  binop(op, a, b) {
    const out: Atom[] = [];
    for (const x of atoms(a)) for (const y of atoms(b)) out.push(...atomOp(op, x, y));
    return fromAtoms(out);
  },
  neg: (a) => fromAtoms(atoms(a).map(atomNeg)),

  // Keep exactly the atoms that can take part in a true comparison.
  refine(op, a, b) {
    const ka: Atom[] = [], kb: Atom[] = [];
    for (const x of atoms(a)) for (const y of atoms(b)) {
      if (cmpPossible(op, x, y)) { ka.push(x); kb.push(y); }
    }
    return [fromAtoms(ka), fromAtoms(kb)];
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
