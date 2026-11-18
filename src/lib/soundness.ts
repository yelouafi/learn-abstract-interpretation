// Soundness, checked on examples: every state the program actually reaches must be
// covered by what the analyzer says about that point.
//
//      α(collected states at p)  ⊑  analysis(p)      for every program point p
//
// Testing cannot prove an analyzer sound, but it is excellent at catching bugs in one.

import type { AnalysisResult } from './analyzer';
import type { Collected } from './collecting';
import type { ValueDomain } from './domain';

export interface Violation { point: string; variable: string; value: number; abstract: string }

export function checkSoundness<V>(c: Collected, a: AnalysisResult<V>, D: ValueDomain<V>): Violation[] {
  const out: Violation[] = [];
  for (const [point, envs] of c.states) {
    const abs = a.states.get(point);
    for (const env of envs) {
      for (const [x, n] of Object.entries(env)) {
        if (!abs || !D.contains(abs[x], n)) {
          out.push({ point, variable: x, value: n, abstract: abs ? D.show(abs[x]) : '⊥' });
        }
      }
    }
  }
  return out;
}
