// The product of two value domains: track both properties side by side (chapter 9).
//
// A pair (a, b) stands for the values described by a AND by b: γ(a, b) = γ(a) ∩ γ(b).
// Every operation works component by component. The only interaction between the two
// sides is that if either one is ⊥, the pair is ⊥ (no value can satisfy both).
// A *reduced* product would go further and let each side refine the other.

import type { ValueDomain } from '../domain';

export type Pair<A, B> = [A, B];

export function productDomain<A, B>(DA: ValueDomain<A>, DB: ValueDomain<B>, opts: { name: string; show?: (a: A, b: B) => string }): ValueDomain<Pair<A, B>> {
  const bottom: Pair<A, B> = [DA.bottom, DB.bottom];
  const isBot = ([a, b]: Pair<A, B>) => DA.leq(a, DA.bottom) || DB.leq(b, DB.bottom);
  const norm = (p: Pair<A, B>): Pair<A, B> => (isBot(p) ? bottom : p);
  return {
    name: opts.name,
    bottom,
    top: [DA.top, DB.top],
    leq: (x, y) => isBot(x) || (DA.leq(x[0], y[0]) && DB.leq(x[1], y[1])),
    join: (x, y) => (isBot(x) ? y : isBot(y) ? x : [DA.join(x[0], y[0]), DB.join(x[1], y[1])]),
    meet: (x, y) => norm([DA.meet(x[0], y[0]), DB.meet(x[1], y[1])]),
    widen: (x, y) => (isBot(x) ? y : isBot(y) ? x : [
      DA.widen ? DA.widen(x[0], y[0]) : DA.join(x[0], y[0]),
      DB.widen ? DB.widen(x[1], y[1]) : DB.join(x[1], y[1]),
    ]),
    narrow: (x, y) => norm([
      DA.narrow ? DA.narrow(x[0], y[0]) : y[0],
      DB.narrow ? DB.narrow(x[1], y[1]) : y[1],
    ]),
    fromConst: (n) => [DA.fromConst(n), DB.fromConst(n)],
    contains: (v, n) => !isBot(v) && DA.contains(v[0], n) && DB.contains(v[1], n),
    binop: (op, x, y) => norm([DA.binop(op, x[0], y[0]), DB.binop(op, x[1], y[1])]),
    neg: (x) => norm([DA.neg(x[0]), DB.neg(x[1])]),
    refine(op, x, y) {
      const [a1, b1] = DA.refine(op, x[0], y[0]);
      const [a2, b2] = DB.refine(op, x[1], y[1]);
      return [norm([a1, a2]), norm([b1, b2])];
    },
    show: (v) => (isBot(v) ? '⊥' : opts.show ? opts.show(v[0], v[1]) : `${DA.show(v[0])} · ${DB.show(v[1])}`),
  };
}
