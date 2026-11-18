import { describe, expect, it } from 'vitest';
import type { BinOp } from './ast';
import type { ValueDomain } from './domain';
import { parse } from './parser';
import { analyze } from './analyzer';
import { collect } from './collecting';
import { checkSoundness } from './soundness';
import { EXAMPLES, example } from './examples';
import { SignDomain, type Sign } from './domains/sign';
import { Signs8Domain } from './domains/signs8';
import { alphaOf } from './domains';

interface Case<V> { name: string; D: ValueDomain<V>; elements: V[] }
const CASES: Case<any>[] = [
  { name: 'signs', D: SignDomain, elements: ['bot', 'neg', 'zero', 'pos', 'top'] as Sign[] },
  { name: 'signs8', D: Signs8Domain, elements: [0, 1, 2, 3, 4, 5, 6, 7] },
];

const SAMPLES = [-9, -2, -1, 0, 1, 2, 9];
// A few finite sets of integers to test α and γ on.
const SETS: number[][] = [[], [0], [3, 7], [-1, -5], [0, 4], [-2, 0], [-3, 3], [-1, 0, 1], [5]];
const OPS: BinOp[] = ['+', '-', '*', '/'];

for (const { name, D, elements } of CASES) {
  describe(`domain ${name}`, () => {
    it('join and meet are least upper / greatest lower bounds', () => {
      for (const a of elements) for (const b of elements) {
        const j = D.join(a, b), m = D.meet(a, b);
        expect(D.leq(a, j) && D.leq(b, j)).toBe(true);
        expect(D.leq(m, a) && D.leq(m, b)).toBe(true);
        for (const c of elements) {
          if (D.leq(a, c) && D.leq(b, c)) expect(D.leq(j, c)).toBe(true);
          if (D.leq(c, a) && D.leq(c, b)) expect(D.leq(c, m)).toBe(true);
        }
      }
    });

    it('forms a Galois connection: α(S) ⊑ a ⟺ S ⊆ γ(a)', () => {
      for (const S of SETS) for (const a of elements) {
        const lhs = D.leq(alphaOf(D, S), a);
        const rhs = S.every((n) => D.contains(a, n));
        expect(lhs, `S=${S} a=${D.show(a)}`).toBe(rhs);
      }
    });

    it('γ is monotone on samples: a ⊑ b ⇒ γ(a) ⊆ γ(b)', () => {
      for (const a of elements) for (const b of elements) {
        if (D.leq(a, b)) for (const n of SAMPLES) if (D.contains(a, n)) expect(D.contains(b, n)).toBe(true);
      }
    });

    it('arithmetic is sound for every abstract input and sample', () => {
      for (const a of elements) for (const b of elements) for (const op of OPS) {
        const r = D.binop(op, a, b);
        for (const x of SAMPLES) for (const y of SAMPLES) {
          if (!D.contains(a, x) || !D.contains(b, y) || (op === '/' && y === 0)) continue;
          const z = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : Math.trunc(x / y);
          expect(D.contains(r, z), `${D.show(a)} ${op} ${D.show(b)} ∌ ${z}`).toBe(true);
        }
      }
    });

    it('is sound on every bundled example', () => {
      for (const ex of EXAMPLES) {
        const p = parse(ex.code);
        expect(checkSoundness(collect(p, { range: 3, fuel: 500 }), analyze(p, D), D), ex.id).toEqual([]);
      }
    });
  });
}

describe('extended signs vs. signs', () => {
  const verdict = (id: string, D: ValueDomain<any>) => [...analyze(parse(example(id).code), D).asserts.values()];

  it('proves what the 5-element domain could not', () => {
    expect(verdict('countdown', SignDomain)).toEqual(['unknown']);
    expect(verdict('countdown', Signs8Domain)).toEqual(['proved']);
    expect(verdict('abs', SignDomain)).toEqual(['unknown']);
    expect(verdict('abs', Signs8Domain)).toEqual(['proved']);
  });

  it('still cannot prove relational facts', () => {
    expect(verdict('copy', Signs8Domain)).toEqual(['unknown']);
    expect(verdict('square', Signs8Domain)).toEqual(['unknown', 'proved']);
  });

  it('proves the chapter 4 exercise 2 program', () => {
    const src = 'x = input();\nif (x >= 0) {\n  y = x * x;\n  assert(y >= 0);\n}\n';
    expect([...analyze(parse(src), Signs8Domain).asserts.values()]).toEqual(['proved']);
    expect([...analyze(parse(src), SignDomain).asserts.values()]).toEqual(['unknown']);
  });

  it('computes the expected values', () => {
    const D = Signs8Domain;
    expect(D.show(D.join(4, 2))).toBe('≥0');
    expect(D.show(D.binop('/', 4, 4))).toBe('≥0');
    expect(D.show(D.binop('*', 6, 6))).toBe('≥0');
    expect(D.show(D.binop('+', 5, 5))).toBe('⊤');
    expect(D.show(alphaOf(D, [-2, 5]))).toBe('≠0');
  });

  it('is never less precise than the 5-element domain', () => {
    // γ(analysis with signs8) ⊆ γ(analysis with signs), checked on samples.
    for (const ex of EXAMPLES) {
      const p = parse(ex.code);
      const a5 = analyze(p, SignDomain), a8 = analyze(p, Signs8Domain);
      for (const [pt, e8] of a8.states) {
        const e5 = a5.states.get(pt);
        if (!e8) continue;
        expect(e5, `${ex.id} ${pt}`).not.toBeNull();
        for (const x of p.vars) for (const n of SAMPLES) {
          if (Signs8Domain.contains(e8[x], n)) expect(SignDomain.contains(e5![x], n), `${ex.id} ${pt} ${x}`).toBe(true);
        }
      }
    }
  });
});
