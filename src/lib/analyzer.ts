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

import { negate, showCond, type Program, type Stmt } from './ast';
import type { ValueDomain } from './domain';
import { pointKey } from './interp';
import { abstractStates, type AEnv, type Alarm, type StateLattice } from './states';

export type { AEnv, Alarm } from './states';

export type AssertVerdict = 'proved' | 'fails' | 'unknown' | 'unreachable';

/** How a loop-head state was obtained: plain iteration, widening, or narrowing. */
export type IterationKind = 'up' | 'widen' | 'narrow';

export interface StateAnalysis<S> {
  /** point key -> abstract state at that point (final, after fixpoints) */
  states: Map<string, S>;
  asserts: Map<number, AssertVerdict>;
  alarms: Alarm[];
  /** while id -> successive loop-head states computed while looking for the fixpoint */
  iterations: Map<number, S[]>;
  /** while id -> how each of those states was obtained */
  iterationKinds: Map<number, IterationKind[]>;
}

/** The result of a non-relational analysis: one abstract value per variable. */
export type AnalysisResult<V> = StateAnalysis<AEnv<V>>;

export interface AnalyzeOptions {
  /** Start widening after this many loop iterations (only if the domain has `widen`). */
  widenDelay?: number;
  /** Turn widening off (the analysis may then not terminate on infinite lattices). */
  widening?: boolean;
  /** Narrowing passes after the loop head is stable (only if the domain has `narrow`). */
  narrowSteps?: number;
  /** Safety net for domains without widening. */
  maxIterations?: number;
  /** If given, every step of the analysis is appended to it (for the playground's stepper). */
  trace?: TraceStep<any>[];
}

/** What kind of step: used by the stepper to jump between loop rounds. */
export type TraceKind = 'assign' | 'assert' | 'test' | 'join' | 'head' | 'widen' | 'narrow' | 'stable' | 'exit';

/** One step of the analysis, in the order the analyzer performed it. */
export interface TraceStep<S> {
  kind: TraceKind;
  /** The source line the step is about. */
  line: number;
  /** The program point whose state this step sets, if any (shown as that line's annotation). */
  point?: string;
  /** The state computed by this step. */
  state: S;
  /** A sentence explaining the step. */
  note: string;
}

export function analyze<V>(p: Program, D: ValueDomain<V>, opts: AnalyzeOptions = {}): AnalysisResult<V> {
  return analyzeStates(p, abstractStates(D, p.vars), opts);
}

/** The same analyzer for any state lattice, including relational ones (chapter 8). */
export function analyzeStates<S>(p: Program, L: StateLattice<S>, opts: AnalyzeOptions = {}): StateAnalysis<S> {
  const widenDelay = opts.widenDelay ?? 3;
  const widening = opts.widening ?? true;
  const narrowSteps = opts.narrowSteps ?? 2;
  const maxIter = opts.maxIterations ?? 1000;
  const states = new Map<string, S>();
  const asserts = new Map<number, AssertVerdict>();
  const alarms = new Map<number, Alarm[]>();
  const iterations = new Map<number, S[]>();
  const iterationKinds = new Map<number, IterationKind[]>();
  const ev = (step: TraceStep<S>) => opts.trace?.push(step);

  const exec = (ss: Stmt[], env: S): S => {
    for (const s of ss) env = execStmt(s, env);
    return env;
  };

  const execStmt = (s: Stmt, env: S): S => {
    switch (s.kind) {
      case 'assign': {
        const report: Alarm[] = [];
        const out = L.assign(env, s.name, s.expr, report, s.id);
        alarms.set(s.id, report);
        states.set(pointKey('after', s.id), out);
        ev({ kind: 'assign', line: s.line, point: pointKey('after', s.id), state: out, note: `Assignment: compute ${s.name} from the state before this line.` });
        return out;
      }
      case 'assert': {
        const t = L.filter(env, s.cond);
        const f = L.filter(env, negate(s.cond));
        const verdict: AssertVerdict = L.isBottom(env) ? 'unreachable' : L.isBottom(f) ? 'proved' : L.isBottom(t) ? 'fails' : 'unknown';
        asserts.set(s.id, verdict);
        alarms.set(s.id,
          verdict === 'fails' ? [{ line: s.line, stmtId: s.id, severity: 'error', message: 'assertion always fails' }]
          : verdict === 'unknown' ? [{ line: s.line, stmtId: s.id, severity: 'warning', message: 'assertion may fail' }]
          : []);
        // Execution continues only when the assertion holds.
        states.set(pointKey('after', s.id), t);
        ev({ kind: 'assert', line: s.line, point: pointKey('after', s.id), state: t, note:
          verdict === 'proved' ? `Assertion: no state here can make (${showCond(s.cond)}) false, so it is proved.`
          : verdict === 'fails' ? `Assertion: no state here can make (${showCond(s.cond)}) true: it always fails.`
          : verdict === 'unreachable' ? 'Assertion: this point is unreachable, so it holds trivially.'
          : `Assertion: some states here may make (${showCond(s.cond)}) false: alarm. Only the states where it holds continue.` });
        return t;
      }
      case 'if': {
        const cond = showCond(s.cond);
        const tIn = L.filter(env, s.cond);
        ev({ kind: 'test', line: s.line, state: tIn, note: `if: the then-branch gets the states where (${cond}) can hold.` });
        const tOut = exec(s.then, tIn);
        const eIn = L.filter(env, negate(s.cond));
        ev({ kind: 'test', line: s.line, state: eIn, note: `if: the else-branch gets the states where (${cond}) can be false.` });
        const eOut = exec(s.else, eIn);
        const out = L.join(tOut, eOut);
        states.set(pointKey('exit', s.id), out);
        ev({ kind: 'join', line: s.endLine, point: pointKey('exit', s.id), state: out, note: 'End of the if: join the states coming out of the two branches.' });
        return out;
      }
      case 'while': {
        // Find the loop invariant I = least solution of  I = env ⊔ body(filter(I, cond)).
        let head = env;
        const hist: S[] = [head];
        const kinds: IterationKind[] = ['up'];
        iterations.set(s.id, hist);
        iterationKinds.set(s.id, kinds);
        const cond = showCond(s.cond);
        const headKey = pointKey('head', s.id);
        const enter = (round: string) => {
          const st = L.filter(head, s.cond);
          ev({ kind: 'test', line: s.line, state: st, note: `${round}: enter the body with the states where (${cond}) can hold.` });
          return st;
        };
        ev({ kind: 'head', line: s.line, point: headKey, state: head, note: 'Loop head, round 1: start from the state that reaches the loop.' });
        // 1. Go up until stable, widening after a few rounds if the domain needs it.
        for (let i = 1; ; i++) {
          const bodyOut = exec(s.body, enter(`Round ${i}`));
          let next = L.join(env, bodyOut);
          if (L.leq(next, head)) { // stable: head is a post-fixpoint
            ev({ kind: 'stable', line: s.line, point: headKey, state: head, note:
              `Back at the loop head: joining the end of the body adds nothing new. The state is stable: it is a loop invariant.` });
            break;
          }
          let kind: IterationKind = 'up';
          if (widening && L.widen && i >= widenDelay) { next = L.widen(head, next); kind = 'widen'; }
          head = next;
          hist.push(head);
          kinds.push(kind);
          ev(kind === 'widen'
            ? { kind: 'widen', line: s.line, point: headKey, state: head, note: `Loop head, round ${i + 1}, widened: join the entry state with the end of the body, then send every bound that is still moving to infinity. Bounds that held still are kept.` }
            : { kind: 'head', line: s.line, point: headKey, state: head, note: `Loop head, round ${i + 1}: join the state on entry to the loop with the state at the end of the body.` });
          if (i >= maxIter) throw new Error(`no fixpoint after ${maxIter} iterations (the domain needs widening)`);
        }
        // 2. Come back down: applying the loop once more to a post-fixpoint stays sound,
        //    and narrowing makes sure this stops.
        if (L.narrow && kinds.includes('widen')) {
          for (let i = 0; i < narrowSteps; i++) {
            const next = L.narrow(head, L.join(env, exec(s.body, enter(`Narrowing pass ${i + 1}`))));
            if (L.leq(head, next)) {
              ev({ kind: 'stable', line: s.line, point: headKey, state: head, note: 'Narrowing: nothing left to tighten at the loop head.' });
              break;
            }
            head = next;
            hist.push(head);
            kinds.push('narrow');
            ev({ kind: 'narrow', line: s.line, point: headKey, state: head, note: 'Loop head, narrowed: go once more around the loop from the widened state, and use the result to replace infinite bounds.' });
          }
        }
        // 3. One last pass so that the states recorded inside the body match the final head.
        exec(s.body, enter('Last pass, so that the body shows the final loop-head state'));
        states.set(headKey, head);
        const out = L.filter(head, negate(s.cond));
        states.set(pointKey('exit', s.id), out);
        ev({ kind: 'exit', line: s.endLine, point: pointKey('exit', s.id), state: out, note: `Leave the loop: keep the loop-head states where (${cond}) can be false.` });
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
