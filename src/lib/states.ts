// Lattices of *program states*, with the two operations a program performs on them:
// assignment and filtering by a condition.
//
// Two implementations share one interface:
//  - concreteStates: finite sets of concrete environments (the collecting semantics,
//    with input() restricted to a small range so that sets stay finite)
//  - abstractStates: one abstract value per variable, for any ValueDomain
//
// The equation solver (equations.ts) and the analyzer (analyzer.ts) are written
// against this interface, so the same algorithm runs on both.

import { negate, type Cond, type Expr } from './ast';
import type { ValueDomain } from './domain';
import { envKey } from './collecting';
import type { Env } from './interp';

export interface Alarm {
  line: number;
  stmtId: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface StateLattice<S> {
  /** No state at all: unreachable. */
  bottom: S;
  /** The state at program start (all variables 0). */
  init: S;
  isBottom(s: S): boolean;
  leq(a: S, b: S): boolean;
  join(a: S, b: S): S;
  /** Optional widening (chapter 6). */
  widen?(a: S, b: S): S;
  /** Optional narrowing (chapter 6). */
  narrow?(a: S, b: S): S;
  /** x = e. Alarms raised while evaluating e are pushed to `report` if given. */
  assign(s: S, x: string, e: Expr, report?: Alarm[], stmtId?: number): S;
  /** Keep only the states in which the condition can be true. */
  filter(s: S, c: Cond): S;
  /** Short text for one variable, e.g. "+" or "{0, 2, 4}". */
  showVar(s: S, x: string): string;
}

// ---------------------------------------------------------------------------------
// Abstract states: Record<var, V>, or null for ⊥.

export type AEnv<V> = Record<string, V> | null;

export function abstractStates<V>(D: ValueDomain<V>, vars: string[]): StateLattice<AEnv<V>> {
  const smash = (env: Record<string, V>): AEnv<V> =>
    Object.values(env).some((v) => D.leq(v, D.bottom)) ? null : env;

  const evalE = (e: Expr, env: Record<string, V>, report?: Alarm[], stmtId = -1): V => {
    switch (e.kind) {
      case 'num': return D.fromConst(e.value);
      case 'var': return env[e.name];
      case 'input': return D.top;
      case 'neg': return D.neg(evalE(e.arg, env, report, stmtId));
      case 'bin': {
        const a = evalE(e.left, env, report, stmtId);
        const b = evalE(e.right, env, report, stmtId);
        if (report && e.op === '/' && D.contains(b, 0) && !D.leq(a, D.bottom)) {
          const sure = D.leq(b, D.fromConst(0));
          report.push({
            line: e.line, stmtId, severity: sure ? 'error' : 'warning',
            message: sure ? 'division by zero' : 'possible division by zero',
          });
        }
        return D.binop(e.op, a, b);
      }
    }
  };

  const L: StateLattice<AEnv<V>> = {
    bottom: null,
    init: Object.fromEntries(vars.map((x) => [x, D.fromConst(0)])),
    isBottom: (s) => s === null,
    leq(a, b) {
      if (!a) return true;
      if (!b) return false;
      return vars.every((x) => D.leq(a[x], b[x]));
    },
    join(a, b) {
      if (!a) return b;
      if (!b) return a;
      return Object.fromEntries(vars.map((x) => [x, D.join(a[x], b[x])]));
    },
    widen: D.widen && ((a, b) => {
      if (!a) return b;
      if (!b) return a;
      return Object.fromEntries(vars.map((x) => [x, D.widen!(a[x], b[x])]));
    }),
    narrow: D.narrow && ((a, b) => {
      if (!a || !b) return null;
      return smash(Object.fromEntries(vars.map((x) => [x, D.narrow!(a[x], b[x])])));
    }),
    assign(s, x, e, report, stmtId) {
      if (!s) return null;
      return smash({ ...s, [x]: evalE(e, s, report, stmtId) });
    },
    filter(s, c) {
      if (!s) return null;
      switch (c.kind) {
        case 'bool': return c.value ? s : null;
        case 'not': return L.filter(s, negate(c.arg));
        case 'and': return L.filter(L.filter(s, c.left), c.right);
        case 'or': return L.join(L.filter(s, c.left), L.filter(s, c.right));
        case 'cmp': {
          const a = evalE(c.left, s), b = evalE(c.right, s);
          const [a2, b2] = D.refine(c.op, a, b);
          if (D.leq(a2, D.bottom) || D.leq(b2, D.bottom)) return null;
          const out = { ...s };
          // Refinement flows back only to bare variables (see chapter 3).
          if (c.left.kind === 'var') out[c.left.name] = D.meet(out[c.left.name], a2);
          if (c.right.kind === 'var') out[c.right.name] = D.meet(out[c.right.name], b2);
          return smash(out);
        }
      }
    },
    showVar: (s, x) => (s ? D.show(s[x]) : '⊥'),
  };
  return L;
}

// ---------------------------------------------------------------------------------
// Concrete states: a finite set of environments, keyed by envKey.

export type CSet = Map<string, Env>;

export interface ConcreteOptions {
  /** input() returns any value in [-range, range]. */
  range?: number;
  /** Values outside [-limit, limit] are dropped, so that sets stay finite. */
  limit?: number;
}

export function concreteStates(vars: string[], opts: ConcreteOptions = {}): StateLattice<CSet> {
  const range = opts.range ?? 3;
  const limit = opts.limit ?? 1000;
  const inputs: number[] = [];
  for (let v = -range; v <= range; v++) inputs.push(v);

  /** All values e can take in env (input() is nondeterministic). Division by zero yields nothing. */
  const values = (e: Expr, env: Env): number[] => {
    switch (e.kind) {
      case 'num': return [e.value];
      case 'var': return [env[e.name]];
      case 'input': return inputs;
      case 'neg': return values(e.arg, env).map((v) => -v);
      case 'bin': {
        const out = new Set<number>();
        for (const a of values(e.left, env)) for (const b of values(e.right, env)) {
          switch (e.op) {
            case '+': out.add(a + b); break;
            case '-': out.add(a - b); break;
            case '*': out.add(a * b); break;
            case '/': if (b !== 0) out.add(Math.trunc(a / b)); break;
          }
        }
        return [...out];
      }
    }
  };

  const holds = (c: Cond, env: Env): boolean => {
    switch (c.kind) {
      case 'bool': return c.value;
      case 'not': return !holds(c.arg, env);
      case 'and': return holds(c.left, env) && holds(c.right, env);
      case 'or': return holds(c.left, env) || holds(c.right, env);
      case 'cmp': {
        // With input() inside a condition, the test may go either way: keep the state if it can be true.
        for (const a of values(c.left, env)) for (const b of values(c.right, env)) {
          const ok = c.op === '<' ? a < b : c.op === '<=' ? a <= b : c.op === '>' ? a > b
            : c.op === '>=' ? a >= b : c.op === '==' ? a === b : a !== b;
          if (ok) return true;
        }
        return false;
      }
    }
  };

  const init: Env = Object.fromEntries(vars.map((x) => [x, 0]));
  return {
    bottom: new Map(),
    init: new Map([[envKey(init), init]]),
    isBottom: (s) => s.size === 0,
    leq(a, b) {
      for (const k of a.keys()) if (!b.has(k)) return false;
      return true;
    },
    join(a, b) {
      if (a.size === 0) return b;
      if (b.size === 0) return a;
      const out = new Map(a);
      for (const [k, v] of b) out.set(k, v);
      return out;
    },
    assign(s, x, e) {
      const out: CSet = new Map();
      for (const env of s.values()) {
        for (const v of values(e, env)) {
          if (Math.abs(v) > limit) continue;
          const n = { ...env, [x]: v };
          out.set(envKey(n), n);
        }
      }
      return out;
    },
    filter(s, c) {
      const out: CSet = new Map();
      for (const [k, env] of s) if (holds(c, env)) out.set(k, env);
      return out;
    },
    showVar(s, x) {
      if (s.size === 0) return '∅';
      return showSet([...s.values()].map((e) => e[x]));
    },
  };
}

/** Compact display of a set of integers. */
export function showSet(ns: number[]): string {
  const s = [...new Set(ns)].sort((a, b) => a - b);
  if (s.length === 0) return '∅';
  const contiguous = s.at(-1)! - s[0] === s.length - 1;
  if (contiguous && s.length > 3) return `{${s[0]}..${s.at(-1)}}`;
  if (s.length > 6) return `{${s.slice(0, 3).join(', ')}, …, ${s.at(-1)}} (${s.length} values)`;
  return `{${s.join(', ')}}`;
}
