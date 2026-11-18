// The collecting semantics, approximated by testing.
//
// The *collecting semantics* maps every program point to the set of ALL states that
// can ever occur there, over all possible inputs. It is the most precise "analysis"
// there is, and in general it is not computable: inputs are unbounded and loops may
// not terminate.
//
// Here we compute an under-approximation: we run the program on every combination
// of inputs drawn from a small range and collect what we see. This is what testing
// does. Abstract interpretation will instead compute an over-approximation.

import type { Program } from './ast';
import { run, type Env, type RunStatus } from './interp';

export interface CollectOptions {
  /** Inputs are drawn from [-range, range]. */
  range?: number;
  /** Stop after this many runs. */
  maxRuns?: number;
  fuel?: number;
}

export interface Collected {
  /** point key -> distinct states seen there */
  states: Map<string, Env[]>;
  runs: { inputs: number[]; status: RunStatus }[];
  truncated: boolean;
}

export function envKey(env: Env): string {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join(',');
}

export function collect(p: Program, opts: CollectOptions = {}): Collected {
  const range = opts.range ?? 3;
  const maxRuns = opts.maxRuns ?? 400;
  const values: number[] = [];
  for (let v = -range; v <= range; v++) values.push(v);

  const states = new Map<string, Map<string, Env>>();
  const runs: Collected['runs'] = [];

  // Odometer over the choices made at each input() call. A run that reads k inputs
  // has k digits; we increment the last digit and drop digits beyond the run's length.
  let choices: number[] = [];
  let truncated = false;
  for (;;) {
    if (runs.length >= maxRuns) { truncated = true; break; }
    const used: number[] = [];
    const res = run(p, {
      fuel: opts.fuel ?? 2_000,
      input: (i) => {
        const c = i < choices.length ? choices[i] : 0;
        used[i] = c;
        return values[c];
      },
    });
    runs.push({ inputs: res.inputsUsed, status: res.status });
    for (const step of res.trace) {
      let m = states.get(step.point);
      if (!m) states.set(step.point, (m = new Map()));
      m.set(envKey(step.env), step.env);
    }
    // advance the odometer
    choices = used.slice();
    let k = choices.length - 1;
    while (k >= 0 && choices[k] === values.length - 1) k--;
    if (k < 0) break;
    choices[k]++;
    choices.length = k + 1;
  }

  const out = new Map<string, Env[]>();
  for (const [k, m] of states) out.set(k, [...m.values()]);
  return { states: out, runs, truncated };
}
