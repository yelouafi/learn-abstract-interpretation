import { describe, expect, it } from 'vitest';
import type { ValueDomain } from './domain';
import { parse } from './parser';
import { programPoints } from './interp';
import { collect } from './collecting';
import { checkSoundness } from './soundness';
import { buildEquations, kleene } from './equations';
import { buildCfg, dfs, showEdge, showWto, weakTopologicalOrder, ENTRY } from './cfg';
import { worklistSolve } from './worklist';
import { abstractStates, concreteStates } from './states';
import { EXAMPLES, example } from './examples';
import { SignDomain } from './domains/sign';
import { Signs8Domain } from './domains/signs8';
import { ParityDomain } from './domains/parity';
import { IntervalDomain, showInterval } from './domains/interval';

describe('control-flow graphs', () => {
  it('has one node per program point', () => {
    for (const ex of EXAMPLES) {
      const p = parse(ex.code);
      expect(buildCfg(p).nodes.map((n) => n.key)).toEqual([ENTRY, ...programPoints(p).map((q) => q.key)]);
    }
  });

  it('builds the countdown graph', () => {
    const cfg = buildCfg(parse(example('countdown').code));
    const name = (k: string) => cfg.nodes.find((n) => n.key === k)!.name;
    expect(cfg.edges.map((e) => `${name(e.from)}→${name(e.to)}: ${showEdge(e)}`)).toEqual([
      'X0→X1: x = input()',
      'X1→X2: y = 0',
      'X2→X3: skip',
      'X3→X4: [x > 0]; x = (x - 1)',
      'X4→X5: y = (y + 2)',
      'X5→X3: skip',
      'X3→X6: [x <= 0]',
      'X6→X7: [y >= 0]',
    ]);
  });

  it('back edges go exactly to loop heads', () => {
    for (const ex of EXAMPLES) {
      const p = parse(ex.code);
      const heads = programPoints(p).filter((q) => q.kind === 'head').map((q) => q.key).sort();
      expect([...new Set(dfs(buildCfg(p)).backEdges.map((e) => e.to))].sort(), ex.id).toEqual(heads);
    }
  });
});

describe('weak topological order', () => {
  it('nests loops', () => {
    const cfg = buildCfg(parse(example('nested').code));
    const name = (k: string) => cfg.nodes.find((n) => n.key === k)!.name;
    expect(showWto(weakTopologicalOrder(cfg), name)).toBe('X0 X1 X2 (X3 X4 (X5 X6 X7) X8 X9) X10 X11');
  });
});

describe('worklist solver', () => {
  for (const D of [SignDomain, Signs8Domain, ParityDomain] as ValueDomain<any>[]) {
    it(`finds the same least fixpoint as Kleene iteration (${D.name})`, () => {
      for (const ex of EXAMPLES) {
        const p = parse(ex.code);
        const L = abstractStates(D, p.vars);
        const lfp = kleene(buildEquations(p, L), L, 'in-order').iterates.at(-1)!;
        for (const order of ['fifo', 'rpo', 'recursive'] as const) {
          const r = worklistSolve(buildCfg(p), L, { order });
          expect(r.stable).toBe(true);
          for (const [k, v] of lfp) expect(r.X.get(k), `${ex.id} ${k} ${order}`).toEqual(v);
        }
      }
    });
  }

  it('computes the collecting semantics on concrete states', () => {
    for (const ex of EXAMPLES.filter((e) => e.id !== 'forever')) {
      const p = parse(ex.code);
      const C = concreteStates(p.vars, { range: 2 });
      const lfp = kleene(buildEquations(p, C), C, 'in-order', 300).iterates.at(-1)!;
      const r = worklistSolve(buildCfg(p), C, { order: 'rpo', maxSteps: 50000 });
      expect(r.stable, ex.id).toBe(true);
      for (const [k, v] of lfp) expect(new Set(r.X.get(k)!.keys()), `${ex.id} ${k}`).toEqual(new Set(v.keys()));
    }
  });

  it('is sound with intervals, widening and narrowing', () => {
    for (const ex of EXAMPLES) {
      const p = parse(ex.code);
      const L = abstractStates(IntervalDomain, p.vars);
      for (const order of ['fifo', 'rpo', 'recursive'] as const) {
        const r = worklistSolve(buildCfg(p), L, { order, widenDelay: 2, narrowSteps: 3 });
        expect(r.stable, ex.id).toBe(true);
        const fake = { states: r.X, asserts: new Map(), alarms: [], iterations: new Map(), iterationKinds: new Map() };
        expect(checkSoundness(collect(p, { range: 3, fuel: 300 }), fake, IntervalDomain), `${ex.id} ${order}`).toEqual([]);
      }
    }
    const p = parse(example('count').code);
    const r = worklistSolve(buildCfg(p), abstractStates(IntervalDomain, p.vars), { widenDelay: 2, narrowSteps: 3 });
    expect(showInterval(r.X.get('exit:1')!.x)).toBe('100');
  });

  it('the recursive strategy keeps nested loops precise under widening', () => {
    const p = parse(example('nested').code);
    const L = abstractStates(IntervalDomain, p.vars);
    const cfg = buildCfg(p);
    const exitI = (order: 'rpo' | 'recursive') => showInterval(worklistSolve(cfg, L, { order, widenDelay: 2, narrowSteps: 3 }).X.get('exit:2')!.i);
    expect(exitI('rpo')).toBe('[10, +∞]');
    expect(exitI('recursive')).toBe('10');
  });

  it('does less work than round-robin iteration', () => {
    for (const ex of EXAMPLES) {
      const p = parse(ex.code);
      const L = abstractStates(Signs8Domain, p.vars);
      const eqs = buildEquations(p, L);
      const roundRobin = kleene(eqs, L, 'in-order').iterates.length * eqs.length; // includes the final check round
      expect(worklistSolve(buildCfg(p), L, { order: 'rpo' }).steps.length, ex.id).toBeLessThanOrEqual(roundRobin);
    }
  });
});
