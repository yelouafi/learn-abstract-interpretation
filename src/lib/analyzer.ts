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
//
// The state operations themselves (assign, filter, join, ...) live in states.ts.

import { negate, type Program, type Stmt } from './ast';
import type { ValueDomain } from './domain';
import { pointKey } from './interp';
import { abstractStates, type AEnv, type Alarm } from './states';

export type { AEnv, Alarm } from './states';

export type AssertVerdict = 'proved' | 'fails' | 'unknown' | 'unreachable';

/** How a loop-head state was obtained: plain iteration, widening, or narrowing. */
export type IterationKind = 'up' | 'widen' | 'narrow';

export interface AnalysisResult<V> {
  /** point key -> abstract state at that point (final, after fixpoints) */
  states: Map<string, AEnv<V>>;
  asserts: Map<number, AssertVerdict>;
  alarms: Alarm[];
  /** while id -> successive loop-head states computed while looking for the fixpoint */
  iterations: Map<number, AEnv<V>[]>;
  /** while id -> how each of those states was obtained */
  iterationKinds: Map<number, IterationKind[]>;
}

export interface AnalyzeOptions {
  /** Start widening after this many loop iterations (only if the domain has `widen`). */
  widenDelay?: number;
  /** Turn widening off (the analysis may then not terminate on infinite lattices). */
  widening?: boolean;
  /** Narrowing passes after the loop head is stable (only if the domain has `narrow`). */
  narrowSteps?: number;
  /** Safety net for domains without widening. */
  maxIterations?: number;
}

export function analyze<V>(p: Program, D: ValueDomain<V>, opts: AnalyzeOptions = {}): AnalysisResult<V> {
  const widenDelay = opts.widenDelay ?? 3;
  const widening = opts.widening ?? true;
  const narrowSteps = opts.narrowSteps ?? 2;
  const maxIter = opts.maxIterations ?? 1000;
  const L = abstractStates(D, p.vars);
  const states = new Map<string, AEnv<V>>();
  const asserts = new Map<number, AssertVerdict>();
  const alarms = new Map<number, Alarm[]>();
  const iterations = new Map<number, AEnv<V>[]>();
  const iterationKinds = new Map<number, IterationKind[]>();

  const exec = (ss: Stmt[], env: AEnv<V>): AEnv<V> => {
    for (const s of ss) env = execStmt(s, env);
    return env;
  };

  const execStmt = (s: Stmt, env: AEnv<V>): AEnv<V> => {
    switch (s.kind) {
      case 'assign': {
        const report: Alarm[] = [];
        const out = L.assign(env, s.name, s.expr, report, s.id);
        alarms.set(s.id, report);
        states.set(pointKey('after', s.id), out);
        return out;
      }
      case 'assert': {
        const t = L.filter(env, s.cond);
        const f = L.filter(env, negate(s.cond));
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
        const out = L.join(exec(s.then, L.filter(env, s.cond)), exec(s.else, L.filter(env, negate(s.cond))));
        states.set(pointKey('exit', s.id), out);
        return out;
      }
      case 'while': {
        // Find the loop invariant I = least solution of  I = env ⊔ body(filter(I, cond)).
        let head = env;
        const hist: AEnv<V>[] = [head];
        const kinds: IterationKind[] = ['up'];
        iterations.set(s.id, hist);
        iterationKinds.set(s.id, kinds);
        // 1. Go up until stable, widening after a few rounds if the domain needs it.
        for (let i = 1; ; i++) {
          const bodyOut = exec(s.body, L.filter(head, s.cond));
          let next = L.join(env, bodyOut);
          if (L.leq(next, head)) break; // stable: head is a post-fixpoint
          let kind: IterationKind = 'up';
          if (widening && L.widen && i >= widenDelay) { next = L.widen(head, next); kind = 'widen'; }
          head = next;
          hist.push(head);
          kinds.push(kind);
          if (i >= maxIter) throw new Error(`no fixpoint after ${maxIter} iterations (the domain needs widening)`);
        }
        // 2. Come back down: applying the loop once more to a post-fixpoint stays sound,
        //    and narrowing makes sure this stops.
        if (L.narrow && kinds.includes('widen')) {
          for (let i = 0; i < narrowSteps; i++) {
            const next = L.narrow(head, L.join(env, exec(s.body, L.filter(head, s.cond))));
            if (L.leq(head, next)) break;
            head = next;
            hist.push(head);
            kinds.push('narrow');
          }
        }
        // 3. One last pass so that the states recorded inside the body match the final head.
        exec(s.body, L.filter(head, s.cond));
        states.set(pointKey('head', s.id), head);
        const out = L.filter(head, negate(s.cond));
        states.set(pointKey('exit', s.id), out);
        return out;
      }
    }
  };

  exec(p.body, L.init);

  return {
    states,
    asserts,
    alarms: [...alarms.values()].flat().sort((a, b) => a.line - b.line),
    iterations,
    iterationKinds,
  };
}
