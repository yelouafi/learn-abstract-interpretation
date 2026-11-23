import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { collect } from './collecting';
import { analyze, analyzeStates } from './analyzer';
import { buildCfg } from './cfg';
import { worklistSolve } from './worklist';
import { EXAMPLES, example } from './examples';
import { IntervalDomain } from './domains/interval';
import { close, zoneStates } from './domains/zones';

const zones = (code: string) => {
  const p = parse(code);
  const Z = zoneStates(p.vars);
  return { p, Z, a: analyzeStates(p, Z) };
};
const verdicts = (a: { asserts: Map<number, string> }) => [...a.asserts.values()];

describe('difference-bound matrices', () => {
  it('closure computes shortest paths', () => {
    // vars 1 = x, 2 = y, 3 = z;  x − y ≤ 1,  y − z ≤ 2  ⇒  x − z ≤ 3
    const I = Infinity;
    const m = close([
      [0, I, I, I],
      [I, 0, 1, I],
      [I, I, 0, 2],
      [I, I, I, 0],
    ])!;
    expect(m[1][3]).toBe(3);
  });

  it('detects contradictions as negative cycles', () => {
    const I = Infinity;
    // x − y ≤ −1 and y − x ≤ 0: x < y ≤ x
    expect(close([[0, I, I], [I, 0, -1], [I, 0, 0]])).toBeNull();
  });
});

describe('zone analysis', () => {
  it('is sound on every example', () => {
    for (const ex of EXAMPLES) {
      const { p, Z, a } = zones(ex.code);
      const c = collect(p, { range: 3, maxRuns: 400, fuel: 200 });
      for (const [point, envs] of c.states) {
        const s = a.states.get(point) ?? null;
        for (const env of envs) expect(Z.contains(s, env), `${ex.id} at ${point}: ${JSON.stringify(env)} not in ${Z.show(s)}`).toBe(true);
      }
    }
  });

  it('is never less precise than intervals on the examples', () => {
    for (const ex of EXAMPLES) {
      const { p, Z, a } = zones(ex.code);
      const b = analyze(p, IntervalDomain);
      for (const [point, s] of a.states) for (const x of p.vars) {
        const iv = b.states.get(point)?.[x] ?? null;
        expect(IntervalDomain.leq(Z.project(s, x), iv), `${ex.id} ${point} ${x}`).toBe(true);
      }
    }
  });

  it('proves what intervals cannot', () => {
    for (const id of ['two-counters', 'copy', 'bounds']) {
      expect(verdicts(analyze(parse(example(id).code), IntervalDomain)), id).toContain('unknown');
      expect(verdicts(zones(example(id).code).a), id).toEqual(verdicts(zones(example(id).code).a).map(() => 'proved'));
    }
    expect(verdicts(zones(example('sum').code).a)).toEqual(['proved', 'proved']);
    expect(verdicts(analyze(parse(example('sum').code), IntervalDomain))).toEqual(['unknown', 'proved']);
  });

  it('cannot prove non-linear facts', () => {
    // y = x * x is not linear: zones fall back to intervals, which cannot see y ≥ 0.
    expect(verdicts(zones(example('square').code).a)).toEqual(['unknown', 'proved']);
  });

  it('finds the lockstep invariant', () => {
    const { p, Z, a } = zones(example('two-counters').code);
    const head = a.states.get(`head:${p.body[2].id}`)!;
    expect(Z.show(head)).toBe('x: [0, 10]   y: [0, 10]   │ y = x');
  });

  it('shows the relations of the bounds example', () => {
    const { p, Z, a } = zones(example('bounds').code);
    const loop = p.body[2];
    if (loop.kind !== 'while') throw new Error();
    expect(Z.relations(a.states.get(`after:${loop.body[0].id}`)!)).toEqual(['i < n', 'k < n', 'k = i']);
  });

  it('cannot express sums', () => {
    // y = −x relates x and y by x + y = 0: an octagon constraint, not a zone one.
    const { a } = zones(`x = input(); y = -x; assert(x + y == 0);`);
    expect(verdicts(a)).toEqual(['unknown']);
  });

  it('works with the worklist solver too', () => {
    for (const id of ['two-counters', 'sum', 'bounds']) {
      const p = parse(example(id).code);
      const Z = zoneStates(p.vars);
      const a = analyzeStates(p, Z);
      const w = worklistSolve(buildCfg(p), Z, { order: 'recursive', widenDelay: 3, narrowSteps: 2 });
      for (const [k, s] of a.states) {
        if (!w.X.has(k)) continue;
        expect(Z.show(w.X.get(k)!), `${id} ${k}`).toBe(Z.show(s));
      }
    }
  });
});
