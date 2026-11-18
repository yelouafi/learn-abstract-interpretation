// A generic abstract interpreter for Tiny, parameterized by a value domain.
//
// It mirrors the concrete interpreter in interp.ts, statement by statement, but
// runs on *abstract environments* (one abstract value per variable) instead of
// concrete ones. Three differences matter:
//
//  1. `if`: we cannot know which branch is taken, so we analyze BOTH and join.
//  2. `while`: we cannot run the loop "until it stops", so we iterate until the
//     loop-head state stops changing — a fixpoint.
//  3. tests: instead of evaluating to true/false, a condition *filters* the state,
//     keeping only the values that can make it true.

import { negate, type Cond, type Expr, type Program, type Stmt } from './ast';
import type { ValueDomain } from './domain';
import { pointKey } from './interp';

/** An abstract environment; `null` is ⊥ (this point is unreachable). */
export type AEnv<V> = Record<string, V> | null;

export type AssertVerdict = 'proved' | 'fails' | 'unknown' | 'unreachable';

export interface Alarm {
  line: number;
  stmtId: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface AnalysisResult<V> {
  /** point key -> abstract state at that point (final, after fixpoints) */
  states: Map<string, AEnv<V>>;
  asserts: Map<number, AssertVerdict>;
  alarms: Alarm[];
  /** while id -> successive loop-head states computed while looking for the fixpoint */
  iterations: Map<number, AEnv<V>[]>;
}

export interface AnalyzeOptions {
  /** Start widening after this many loop iterations (only if the domain has `widen`). */
  widenDelay?: number;
  /** Safety net for domains without widening. */
  maxIterations?: number;
}

export function analyze<V>(p: Program, D: ValueDomain<V>, opts: AnalyzeOptions = {}): AnalysisResult<V> {
  const widenDelay = opts.widenDelay ?? 3;
  const maxIter = opts.maxIterations ?? 1000;
  const states = new Map<string, AEnv<V>>();
  const asserts = new Map<number, AssertVerdict>();
  const alarms = new Map<number, Alarm[]>();
  const iterations = new Map<number, AEnv<V>[]>();

  // ---- environments as a lattice (pointwise) ----------------------------------
  const smash = (env: Record<string, V>): AEnv<V> =>
    Object.values(env).some((v) => D.leq(v, D.bottom)) ? null : env;
  const joinEnv = (a: AEnv<V>, b: AEnv<V>): AEnv<V> => {
    if (!a) return b;
    if (!b) return a;
    return Object.fromEntries(p.vars.map((x) => [x, D.join(a[x], b[x])]));
  };
  const widenEnv = (a: AEnv<V>, b: AEnv<V>): AEnv<V> => {
    if (!a) return b;
    if (!b) return a;
    return Object.fromEntries(p.vars.map((x) => [x, D.widen!(a[x], b[x])]));
  };
  const leqEnv = (a: AEnv<V>, b: AEnv<V>): boolean => {
    if (!a) return true;
    if (!b) return false;
    return p.vars.every((x) => D.leq(a[x], b[x]));
  };

  // ---- expressions ----------------------------------------------------------------
  const evalE = (e: Expr, env: Record<string, V>, report: Alarm[], stmtId: number): V => {
    switch (e.kind) {
      case 'num': return D.fromConst(e.value);
      case 'var': return env[e.name];
      case 'input': return D.top;
      case 'neg': return D.neg(evalE(e.arg, env, report, stmtId));
      case 'bin': {
        const a = evalE(e.left, env, report, stmtId);
        const b = evalE(e.right, env, report, stmtId);
        if (e.op === '/' && D.contains(b, 0) && !D.leq(a, D.bottom)) {
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

  // ---- conditions: filter the environment -----------------------------------------
  const filter = (env: AEnv<V>, c: Cond, stmtId: number): AEnv<V> => {
    if (!env) return null;
    switch (c.kind) {
      case 'bool': return c.value ? env : null;
      case 'not': return filter(env, negate(c.arg), stmtId);
      case 'and': return filter(filter(env, c.left, stmtId), c.right, stmtId);
      case 'or': return joinEnv(filter(env, c.left, stmtId), filter(env, c.right, stmtId));
      case 'cmp': {
        const ignore: Alarm[] = [];
        const a = evalE(c.left, env, ignore, stmtId);
        const b = evalE(c.right, env, ignore, stmtId);
        const [a2, b2] = D.refine(c.op, a, b);
        if (D.leq(a2, D.bottom) || D.leq(b2, D.bottom)) return null;
        const out = { ...env };
        // Propagate the refinement back to variables. (Only for bare variables:
        // refining `x + 1 > 0` back to x would need backward arithmetic.)
        if (c.left.kind === 'var') out[c.left.name] = D.meet(out[c.left.name], a2);
        if (c.right.kind === 'var') out[c.right.name] = D.meet(out[c.right.name], b2);
        return smash(out);
      }
    }
  };

  // ---- statements -------------------------------------------------------------------
  const exec = (ss: Stmt[], env: AEnv<V>): AEnv<V> => {
    for (const s of ss) env = execStmt(s, env);
    return env;
  };

  const execStmt = (s: Stmt, env: AEnv<V>): AEnv<V> => {
    switch (s.kind) {
      case 'assign': {
        const report: Alarm[] = [];
        let out: AEnv<V> = null;
        if (env) out = smash({ ...env, [s.name]: evalE(s.expr, env, report, s.id) });
        alarms.set(s.id, report);
        states.set(pointKey('after', s.id), out);
        return out;
      }
      case 'assert': {
        const t = filter(env, s.cond, s.id);
        const f = filter(env, negate(s.cond), s.id);
        const verdict: AssertVerdict = !env ? 'unreachable' : !f ? 'proved' : !t ? 'fails' : 'unknown';
        asserts.set(s.id, verdict);
        alarms.set(s.id,
          verdict === 'fails' ? [{ line: s.line, stmtId: s.id, severity: 'error', message: 'assertion always fails' }]
          : verdict === 'unknown' ? [{ line: s.line, stmtId: s.id, severity: 'warning', message: 'assertion may fail' }]
          : []);
        // Execution continues only when the assertion holds.
        states.set(pointKey('after', s.id), t);
        return t;
      }
      case 'if': {
        const out = joinEnv(exec(s.then, filter(env, s.cond, s.id)), exec(s.else, filter(env, negate(s.cond), s.id)));
        states.set(pointKey('exit', s.id), out);
        return out;
      }
      case 'while': {
        // Find the loop invariant I = least solution of  I = env ⊔ body(filter(I, cond)).
        let head = env;
        const hist: AEnv<V>[] = [head];
        iterations.set(s.id, hist);
        for (let i = 1; ; i++) {
          const bodyOut = exec(s.body, filter(head, s.cond, s.id));
          let next = joinEnv(env, bodyOut);
          if (leqEnv(next, head)) break; // stable: the last body pass used the fixpoint
          if (D.widen && i >= widenDelay) next = widenEnv(head, next);
          head = next;
          hist.push(head);
          if (i >= maxIter) throw new Error(`no fixpoint after ${maxIter} iterations (the domain needs widening)`);
        }
        states.set(pointKey('head', s.id), head);
        const out = filter(head, negate(s.cond), s.id);
        states.set(pointKey('exit', s.id), out);
        return out;
      }
    }
  };

  const init: AEnv<V> = Object.fromEntries(p.vars.map((x) => [x, D.fromConst(0)]));
  exec(p.body, init);

  return {
    states,
    asserts,
    alarms: [...alarms.values()].flat().sort((a, b) => a.line - b.line),
    iterations,
  };
}
