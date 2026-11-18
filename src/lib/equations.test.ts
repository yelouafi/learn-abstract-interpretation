import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import type { ValueDomain } from './domain';
import { analyze } from './analyzer';
import { collect, envKey } from './collecting';
import { buildEquations, kleene, ENTRY } from './equations';
import { abstractStates, concreteStates } from './states';
import { EXAMPLES, example } from './examples';
import { SignDomain } from './domains/sign';
import { Signs8Domain } from './domains/signs8';

describe('equation systems', () => {
  it('prints the classic countdown equations', () => {
    const p = parse(example('countdown').code);
    const eqs = buildEquations(p, abstractStates(SignDomain, p.vars));
    expect(eqs.map((u) => `${u.name} = ${u.rhs}`)).toEqual([
      'X0 = initial state (all variables 0)',
      'X1 = ⟦x = input()⟧ X0',
      'X2 = ⟦y = 0⟧ X1',
      'X3 = X2 ⊔ X5',
      'X4 = ⟦x = (x - 1)⟧ [x > 0] X3',
      'X5 = ⟦y = (y + 2)⟧ X4',
      'X6 = [x <= 0] X3',
      'X7 = [y >= 0] X6',
    ]);
  });

  for (const D of [SignDomain, Signs8Domain] as ValueDomain<any>[]) {
    it(`Kleene iteration agrees with the structural analyzer (${D.name})`, () => {
      for (const ex of EXAMPLES) {
        const p = parse(ex.code);
        const L = abstractStates(D, p.vars);
        const a = analyze(p, D);
        for (const strategy of ['jacobi', 'in-order'] as const) {
          const r = kleene(buildEquations(p, L), L, strategy);
          expect(r.stable, ex.id).toBe(true);
          const lfp = r.iterates.at(-1)!;
          for (const [k, v] of a.states) expect(lfp.get(k), `${ex.id} ${k} ${strategy}`).toEqual(v);
        }
      }
    });
  }

  it('concrete Kleene iteration is the collecting semantics', () => {
    for (const ex of EXAMPLES.filter((e) => e.id !== 'forever')) {
      const p = parse(ex.code);
      const L = concreteStates(p.vars, { range: 2 });
      const r = kleene(buildEquations(p, L), L, 'in-order', 200);
      expect(r.stable, ex.id).toBe(true);
      const lfp = r.iterates.at(-1)!;
      const c = collect(p, { range: 2, maxRuns: 5000 });
      for (const [k, envs] of c.states) {
        expect(new Set(lfp.get(k)!.keys()), `${ex.id} ${k}`).toEqual(new Set(envs.map(envKey)));
      }
    }
  });

  it('in-order iteration never needs more rounds than Jacobi', () => {
    for (const ex of EXAMPLES) {
      const p = parse(ex.code);
      const L = abstractStates(Signs8Domain, p.vars);
      const eqs = buildEquations(p, L);
      expect(kleene(eqs, L, 'in-order').iterates.length).toBeLessThanOrEqual(kleene(eqs, L, 'jacobi').iterates.length);
    }
  });

  it('abstract iteration terminates where concrete iteration does not', () => {
    const p = parse(example('forever').code);
    const C = concreteStates(p.vars);
    expect(kleene(buildEquations(p, C), C, 'in-order', 40).stable).toBe(false);
    const A = abstractStates(Signs8Domain, p.vars);
    const r = kleene(buildEquations(p, A), A, 'jacobi');
    expect(r.stable).toBe(true);
    const lfp = r.iterates.at(-1)!;
    expect(lfp.get('head:1')).toEqual({ x: 6, y: 2 }); // x: ≥0, y: 0
    expect(lfp.get('exit:1')).toBeNull();               // the loop never exits
    expect(lfp.get(ENTRY)).toEqual({ x: 2, y: 2 });
  });
});
