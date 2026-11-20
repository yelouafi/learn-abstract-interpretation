// The interface every abstract *value* domain implements.
//
// An abstract value V stands for a set of integers, γ(V). The domain must be a
// lattice ordered by precision: a ⊑ b means "a says at least as much as b",
// i.e. γ(a) ⊆ γ(b).

import type { BinOp, CmpOp } from './ast';

export interface ValueDomain<V> {
  name: string;

  /** ⊥: the empty set of values (unreachable / impossible). */
  bottom: V;
  /** ⊤: any integer (we know nothing). */
  top: V;

  /** a ⊑ b: is a at least as precise as b? */
  leq(a: V, b: V): boolean;
  /** a ⊔ b: the most precise value covering both (used where control flow merges). */
  join(a: V, b: V): V;
  /** a ⊓ b: the most precise value covering what both agree on (used to refine). */
  meet(a: V, b: V): V;
  /**
   * Widening a ∇ b, for domains with infinite ascending chains (chapter 6).
   * Must be an upper bound of a and b, and must make every increasing sequence stop.
   */
  widen?(a: V, b: V): V;
  /**
   * Narrowing a Δ b, used after widening to win back precision (chapter 6).
   * Called with b ⊑ a; must return something between b and a, and must stop.
   */
  narrow?(a: V, b: V): V;

  /** α({n}): abstraction of a single integer. */
  fromConst(n: number): V;
  /** Does γ(v) contain n? Used for soundness checks and for alarms. */
  contains(v: V, n: number): boolean;

  /** Abstract arithmetic: must over-approximate the concrete operator. */
  binop(op: BinOp, a: V, b: V): V;
  neg(a: V): V;

  /**
   * Backward refinement for a test `a op b`: return the parts of a and b that can
   * make the test true. Returning the inputs unchanged is always sound (but useless).
   */
  refine(op: CmpOp, a: V, b: V): [V, V];

  show(v: V): string;
}

export function equal<V>(d: ValueDomain<V>, a: V, b: V) {
  return d.leq(a, b) && d.leq(b, a);
}
