// The parity domain (chapter 4, exercise 3), plugged into the engine in chapter 7.
//
//          ⊤
//        /   \
//     Even   Odd
//        \   /
//          ⊥
//
// Same recipe as signs, with two basic cases instead of three: split into cases,
// work out each combination, summarize.

import type { BinOp } from '../ast';
import type { ValueDomain } from '../domain';

export type BasicParity = 'even' | 'odd';
export type Parity = 'bot' | BasicParity | 'top';

const cases = (v: Parity): BasicParity[] => (v === 'bot' ? [] : v === 'top' ? ['even', 'odd'] : [v]);
const summarize = (ps: BasicParity[]): Parity => {
  const distinct = new Set(ps);
  return distinct.size === 0 ? 'bot' : distinct.size === 2 ? 'top' : ps[0];
};
const parityOf = (n: number): BasicParity => (n % 2 === 0 ? 'even' : 'odd');

/** Which parities can x op y have? */
function possibleParities(op: BinOp, a: BasicParity, b: BasicParity): BasicParity[] {
  if (op === '+' || op === '-') return [a === b ? 'even' : 'odd'];
  if (op === '*') return [a === 'even' || b === 'even' ? 'even' : 'odd'];
  return ['even', 'odd']; // division: 6 / 2 = 3, 4 / 2 = 2
}

export const ParityDomain: ValueDomain<Parity> = {
  name: 'Parity',
  bottom: 'bot',
  top: 'top',
  leq: (a, b) => a === b || a === 'bot' || b === 'top',
  join: (a, b) => (a === b ? a : a === 'bot' ? b : b === 'bot' ? a : 'top'),
  meet: (a, b) => (a === b ? a : a === 'top' ? b : b === 'top' ? a : 'bot'),
  fromConst: (n) => parityOf(n),
  contains: (v, n) => cases(v).includes(parityOf(n)),
  binop(op, a, b) {
    const results: BasicParity[] = [];
    for (const x of cases(a)) for (const y of cases(b)) results.push(...possibleParities(op, x, y));
    return summarize(results);
  },
  neg: (a) => a,
  // Only equality tells us anything about parity.
  refine: (op, a, b) => (op === '==' ? [ParityDomain.meet(a, b), ParityDomain.meet(a, b)] : [a, b]),
  show: (v) => ({ bot: '⊥', even: 'even', odd: 'odd', top: '⊤' })[v],
};
