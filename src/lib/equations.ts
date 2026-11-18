// A program as a system of equations, and Kleene iteration to solve it.
//
// There is one unknown X_i per program point (plus X_0 for the program start). Each
// unknown is defined by an equation whose right-hand side reads other unknowns:
//
//   X_0 = init
//   X_1 = ⟦x = input()⟧ X_0
//   X_3 = X_2 ⊔ X_5                       (loop head: from before the loop, or from the body)
//   X_4 = ⟦x = x - 1⟧ [x > 0] X_3
//
// Together the equations form one function F on vectors of states, and the program's
// meaning is the least fixpoint of F. Kleene iteration computes it:
//
//   X⁰ = (⊥, ⊥, …),   Xᵏ⁺¹ = F(Xᵏ),   stop when Xᵏ⁺¹ = Xᵏ.

import { negate, showCond, showExpr, type Program, type Stmt } from './ast';
import { programPoints, pointKey, type PointKind } from './interp';
import type { StateLattice } from './states';

export type Solution<S> = Map<string, S>;

export interface Unknown<S> {
  key: string;
  /** X_i */
  name: string;
  /** Source line where the point is displayed (0 for the program start). */
  line: number;
  kind: PointKind | 'entry';
  /** Human-readable right-hand side, e.g. "X2 ⊔ X5". */
  rhs: string;
  /** Evaluate the right-hand side in the current solution. */
  eval: (X: Solution<S>) => S;
}

export const ENTRY = 'entry';

const KIND_LABEL: Record<Unknown<unknown>['kind'], string> = {
  entry: 'program start',
  after: 'after statement',
  head: 'loop head',
  exit: 'after if/while',
};
export const kindLabel = (k: Unknown<unknown>['kind']) => KIND_LABEL[k];

export function buildEquations<S>(p: Program, L: StateLattice<S>): Unknown<S>[] {
  const names = new Map<string, string>([[ENTRY, 'X0']]);
  programPoints(p).forEach((pt, i) => names.set(pt.key, `X${i + 1}`));
  const name = (k: string) => names.get(k)!;

  const eqs = new Map<string, Unknown<S>>();
  eqs.set(ENTRY, { key: ENTRY, name: 'X0', line: 0, kind: 'entry', rhs: 'initial state (all variables 0)', eval: () => L.init });

  // An "input" is the state flowing into the next statement, as code and as text.
  interface In { f: (X: Solution<S>) => S; text: string }
  const ref = (k: string): In => ({ f: (X) => X.get(k)!, text: name(k) });

  const add = (key: string, line: number, kind: PointKind, rhs: string, f: (X: Solution<S>) => S) =>
    eqs.set(key, { key, name: name(key), line, kind, rhs, eval: f });

  const block = (ss: Stmt[], inp: In): In => {
    for (const s of ss) inp = stmt(s, inp);
    return inp;
  };

  const stmt = (s: Stmt, inp: In): In => {
    switch (s.kind) {
      case 'assign': {
        const k = pointKey('after', s.id);
        add(k, s.line, 'after', `⟦${s.name} = ${showExpr(s.expr)}⟧ ${inp.text}`, (X) => L.assign(inp.f(X), s.name, s.expr));
        return ref(k);
      }
      case 'assert': {
        const k = pointKey('after', s.id);
        add(k, s.line, 'after', `[${showCond(s.cond)}] ${inp.text}`, (X) => L.filter(inp.f(X), s.cond));
        return ref(k);
      }
      case 'if': {
        const neg = negate(s.cond);
        const t = block(s.then, { f: (X) => L.filter(inp.f(X), s.cond), text: `[${showCond(s.cond)}] ${inp.text}` });
        const e = block(s.else, { f: (X) => L.filter(inp.f(X), neg), text: `[${showCond(neg)}] ${inp.text}` });
        const k = pointKey('exit', s.id);
        add(k, s.endLine, 'exit', `${t.text} ⊔ ${e.text}`, (X) => L.join(t.f(X), e.f(X)));
        return ref(k);
      }
      case 'while': {
        const head = pointKey('head', s.id);
        const neg = negate(s.cond);
        // Reserve the head first so that equations print in program order.
        add(head, s.line, 'head', '', () => L.bottom);
        const body = block(s.body, { f: (X) => L.filter(X.get(head)!, s.cond), text: `[${showCond(s.cond)}] ${name(head)}` });
        add(head, s.line, 'head', `${inp.text} ⊔ ${body.text}`, (X) => L.join(inp.f(X), body.f(X)));
        const k = pointKey('exit', s.id);
        add(k, s.endLine, 'exit', `[${showCond(neg)}] ${name(head)}`, (X) => L.filter(X.get(head)!, neg));
        return ref(k);
      }
    }
  };

  block(p.body, ref(ENTRY));
  // Return in X-number order.
  return [...names.keys()].map((k) => eqs.get(k)!);
}

export type Strategy = 'jacobi' | 'in-order';

export interface KleeneResult<S> {
  /** iterates[k] is the solution after k rounds; iterates[0] is all ⊥. */
  iterates: Solution<S>[];
  /** changed[k] lists the unknowns whose value changed in round k (k ≥ 1). */
  changed: Set<string>[];
  /** Did the iteration reach a fixpoint within maxRounds? */
  stable: boolean;
}

/**
 * Kleene iteration from ⊥.
 *  - 'jacobi':   every equation reads the previous round's values: X^{k+1} = F(X^k).
 *  - 'in-order': equations are evaluated top to bottom, each one already seeing the
 *                values updated earlier in the same round (Gauss–Seidel). Same limit, fewer rounds.
 */
export function kleene<S>(eqs: Unknown<S>[], L: StateLattice<S>, strategy: Strategy = 'jacobi', maxRounds = 50): KleeneResult<S> {
  let X: Solution<S> = new Map(eqs.map((u) => [u.key, L.bottom]));
  const iterates = [X];
  const changed: Set<string>[] = [new Set()];
  for (let k = 1; k <= maxRounds; k++) {
    const next: Solution<S> = new Map(X);
    const read = strategy === 'jacobi' ? X : next;
    const ch = new Set<string>();
    for (const u of eqs) {
      const v = u.eval(read);
      if (!L.leq(v, next.get(u.key)!) || !L.leq(next.get(u.key)!, v)) ch.add(u.key);
      next.set(u.key, v);
    }
    if (ch.size === 0) return { iterates, changed, stable: true };
    X = next;
    iterates.push(X);
    changed.push(ch);
  }
  return { iterates, changed, stable: false };
}
