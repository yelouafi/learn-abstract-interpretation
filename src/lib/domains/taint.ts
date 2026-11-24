// Taint: does a value depend on the program's input? (chapter 9)
//
//        tainted        some value derived from input()
//           |
//         clean         derived from constants only
//           |
//           ⊥
//
// Unlike signs or intervals, taint says nothing about *which* integer a value is.
// It abstracts an *instrumented* semantics in which every value carries a label,
// "came from input" or not, and every operation labels its result with the join
// of its operands' labels. Only data flow is tracked: a value assigned under a
// tainted test stays clean (the "implicit flows" of chapter 9).

import type { ValueDomain } from '../domain';

export type Taint = 'bot' | 'clean' | 'tainted';

const rank: Record<Taint, number> = { bot: 0, clean: 1, tainted: 2 };
const max = (a: Taint, b: Taint): Taint => (rank[a] >= rank[b] ? a : b);
const min = (a: Taint, b: Taint): Taint => (rank[a] <= rank[b] ? a : b);

export const TaintDomain: ValueDomain<Taint> = {
  name: 'Taint',
  bottom: 'bot',
  // ⊤ is what input() returns: a value the user controls.
  top: 'tainted',
  leq: (a, b) => rank[a] <= rank[b],
  join: max,
  meet: min,
  fromConst: () => 'clean',
  // Taint does not restrict the value itself.
  contains: (v) => v !== 'bot',
  // The result depends on both operands: it is tainted if either one is.
  binop: (_op, a, b) => (a === 'bot' || b === 'bot' ? 'bot' : max(a, b)),
  neg: (a) => a,
  // A test tells us nothing about where a value came from.
  refine: (_op, a, b) => [a, b],
  show: (v) => (v === 'bot' ? '⊥' : v),
};
