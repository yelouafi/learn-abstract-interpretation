import { describe, expect, it } from 'vitest';
import { parse, ParseError } from './parser';
import { run, programPoints, pointKey } from './interp';
import { collect } from './collecting';
import { analyze } from './analyzer';
import { checkSoundness } from './soundness';
import { SignDomain as S, alphaSign, cases, BASIC_SIGNS, SAMPLES, signOf, possibleSigns, canBeTrue, type Sign } from './domains/sign';
import type { BinOp, CmpOp } from './ast';
import { EXAMPLES } from './examples';

const SIGNS: Sign[] = ['bot', 'neg', 'zero', 'pos', 'top'];

describe('parser', () => {
  it('parses statements and records variables', () => {
    const p = parse('x = input(); while (x > 0) { x = x - 1; } if (x == 0) { y = 1; } else { y = 2; } assert(y > 0);');
    expect(p.vars).toEqual(['x', 'y']);
    expect(p.body.map((s) => s.kind)).toEqual(['assign', 'while', 'if', 'assert']);
  });
  it('handles parenthesized expressions in comparisons and conditions', () => {
    expect(() => parse('assert((x + 1) * 2 > 0 && (y < 0 || !(y == 3)));')).not.toThrow();
  });
  it('reports errors with positions', () => {
    try { parse('x = ;'); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).line).toBe(1);
    }
  });
  it('supports else if', () => {
    const p = parse('if (x < 0) { y = -1; } else if (x == 0) { y = 0; } else { y = 1; }');
    expect(p.body).toHaveLength(1);
  });
});

describe('interpreter', () => {
  it('runs a loop', () => {
    const p = parse('x = input(); y = 0; while (x > 0) { x = x - 1; y = y + 2; }');
    const r = run(p, { input: () => 3 });
    expect(r.status.kind).toBe('ok');
    expect(r.trace.at(-1)!.env).toEqual({ x: 0, y: 6 });
  });
  it('truncates division and traps division by zero', () => {
    expect(run(parse('x = -7 / 2;'), { input: () => 0 }).trace.at(-1)!.env.x).toBe(-3);
    expect(run(parse('x = 1 / 0;'), { input: () => 0 }).status.kind).toBe('error');
  });
  it('stops on failed assertions and runaway loops', () => {
    expect(run(parse('assert(1 < 0);'), { input: () => 0 }).status.kind).toBe('assert-failed');
    expect(run(parse('while (0 == 0) { x = x + 1; }'), { input: () => 0, fuel: 10 }).status.kind).toBe('out-of-fuel');
  });
  it('enumerates program points', () => {
    const p = parse('x = 1;\nwhile (x > 0) {\n  x = x - 1;\n}\n');
    expect(programPoints(p).map((q) => `${q.key}@${q.line}`)).toEqual(['after:0@1', 'head:1@2', 'after:2@3', 'exit:1@4']);
  });
});

describe('collecting semantics', () => {
  it('enumerates all input combinations', () => {
    const c = collect(parse('x = input(); y = input();'), { range: 1 });
    expect(c.runs).toHaveLength(9);
    expect(c.states.get(pointKey('after', 1))).toHaveLength(9);
  });
});

describe('sign domain', () => {
  it('is a lattice: join is an upper bound, meet a lower bound', () => {
    for (const a of SIGNS) for (const b of SIGNS) {
      const j = S.join(a, b), m = S.meet(a, b);
      expect(S.leq(a, j) && S.leq(b, j)).toBe(true);
      expect(S.leq(m, a) && S.leq(m, b)).toBe(true);
    }
  });
  it('arithmetic is sound on sample values', () => {
    const samples = [-7, -2, -1, 0, 1, 2, 7];
    for (const x of samples) for (const y of samples) {
      const sx = alphaSign([x]), sy = alphaSign([y]);
      expect(S.contains(S.binop('+', sx, sy), x + y)).toBe(true);
      expect(S.contains(S.binop('-', sx, sy), x - y)).toBe(true);
      expect(S.contains(S.binop('*', sx, sy), x * y)).toBe(true);
      if (y !== 0) expect(S.contains(S.binop('/', sx, sy), Math.trunc(x / y))).toBe(true);
    }
  });
  it('computes the classic tables', () => {
    expect(S.binop('+', 'pos', 'pos')).toBe('pos');
    expect(S.binop('+', 'pos', 'neg')).toBe('top');
    expect(S.binop('*', 'neg', 'neg')).toBe('pos');
    expect(S.binop('*', 'top', 'zero')).toBe('zero');
    expect(S.binop('/', 'pos', 'pos')).toBe('top'); // could be 0: 1/2
  });
  it('refines comparisons', () => {
    expect(S.refine('>', 'top', 'zero')).toEqual(['pos', 'zero']);
    expect(S.refine('<=', 'top', 'zero')).toEqual(['top', 'zero']); // {neg, zero} rounds up to ⊤
    expect(S.refine('==', 'top', 'zero')).toEqual(['zero', 'zero']);
    expect(S.refine('<', 'pos', 'zero')[0]).toBe('bot');
    expect(cases(S.refine('!=', 'zero', 'zero')[0])).toEqual([]);
  });
});

describe('sign analysis', () => {
  const at = (src: string, kind: 'after' | 'head' | 'exit', id: number) => analyze(parse(src), S).states.get(pointKey(kind, id));

  it('uses branch conditions', () => {
    const src = 'x = input(); if (x > 0) { y = x; } else { y = 0 - x; } assert(y >= 0);';
    const r = analyze(parse(src), S);
    expect(r.states.get(pointKey('after', 2))).toEqual({ x: 'pos', y: 'pos' });
    // y = 0 - x with x in {neg, zero} (rounded to ⊤) -> ⊤: the assertion can't be proved
    expect(r.asserts.get(4)).toBe('unknown');
  });
  it('finds loop invariants', () => {
    expect(at('x = 1; while (x < 100) { x = x + 1; }', 'head', 1)).toEqual({ x: 'pos' });
    expect(at('x = 1; y = 0; while (x < 100) { y = y + x; x = x + 1; }', 'head', 2)).toEqual({ x: 'pos', y: 'top' });
  });
  it('proves assertions and reports alarms', () => {
    const r = analyze(parse('x = input(); y = x * x; assert(y >= 0); z = 10 / x;'), S);
    expect(r.asserts.get(2)).toBe('unknown'); // x*x with x=⊤ is ⊤: signs don't know x*x ≥ 0
    expect(r.alarms.some((a) => a.message === 'possible division by zero')).toBe(true);
    const r2 = analyze(parse('x = input(); if (x > 0) { y = x * 3; assert(y > 0); }'), S);
    expect(r2.asserts.get(3)).toBe('proved');
  });
  it('detects unreachable code', () => {
    const r = analyze(parse('x = 5; if (x < 0) { y = 1; }'), S);
    expect(r.states.get(pointKey('after', 2))).toBeNull();
  });
  it('is sound on every bundled example', () => {
    for (const ex of EXAMPLES) {
      const p = parse(ex.code);
      const c = collect(p, { range: 3, maxRuns: 400, fuel: 500 });
      const a = analyze(p, S);
      expect(checkSoundness(c, a, S), ex.id).toEqual([]);
    }
  });
});

describe('case-by-case sign rules', () => {
  // The calculator shows sample computations as evidence; check that the samples
  // produce exactly the signs the rules claim, no more and no less.
  const OPS: BinOp[] = ['+', '-', '*', '/'];
  const CMPS: CmpOp[] = ['<', '<=', '>', '>=', '==', '!='];
  const apply = (op: BinOp, x: number, y: number) =>
    op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : Math.trunc(x / y);
  const holds = (op: CmpOp, x: number, y: number) =>
    op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : op === '>=' ? x >= y : op === '==' ? x === y : x !== y;

  it('possibleSigns matches what the samples produce', () => {
    for (const op of OPS) for (const a of BASIC_SIGNS) for (const b of BASIC_SIGNS) {
      const seen = new Set<string>();
      for (const x of SAMPLES[a]) for (const y of SAMPLES[b]) if (!(op === '/' && y === 0)) seen.add(signOf(apply(op, x, y)));
      expect(new Set(possibleSigns(op, a, b)), `${a} ${op} ${b}`).toEqual(seen);
    }
  });

  it('canBeTrue matches what the samples show', () => {
    for (const op of CMPS) for (const a of BASIC_SIGNS) for (const b of BASIC_SIGNS) {
      const some = SAMPLES[a].some((x) => SAMPLES[b].some((y) => holds(op, x, y)));
      expect(canBeTrue(op, a, b), `${a} ${op} ${b}`).toBe(some);
    }
  });
});
