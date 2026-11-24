// Chapter 9: taint (a non-numeric domain), products of domains, disjunctive states.
import { describe, expect, it } from 'vitest';
import type { Cond, Expr, Stmt } from './ast';
import { parse } from './parser';
import { analyze, analyzeStates } from './analyzer';
import { collect } from './collecting';
import { EXAMPLES, example } from './examples';
import { domainById } from './domains';
import { IntervalDomain, type Interval } from './domains/interval';
import { TaintDomain, type Taint } from './domains/taint';
import { abstractStates, type AEnv } from './states';
import { disjunctive } from './disjunctive';

// The instrumented semantics that taint abstracts: every value carries a label.
type Tagged = { v: number; t: boolean };
function runTagged(code: string, inputs: number[]) {
  const p = parse(code);
  const seen = new Map<string, Record<string, boolean>>(); // point -> variables seen tainted
  let k = 0, fuel = 300;
  const env: Record<string, Tagged> = Object.fromEntries(p.vars.map((x) => [x, { v: 0, t: false }]));
  const ev = (e: Expr): Tagged => {
    switch (e.kind) {
      case 'num': return { v: e.value, t: false };
      case 'var': return env[e.name];
      case 'input': return { v: inputs[k++] ?? 0, t: true };
      case 'neg': { const a = ev(e.arg); return { v: -a.v, t: a.t }; }
      case 'bin': {
        const a = ev(e.left), b = ev(e.right);
        if (e.op === '/' && b.v === 0) throw new Error('div0');
        const v = e.op === '+' ? a.v + b.v : e.op === '-' ? a.v - b.v : e.op === '*' ? a.v * b.v : Math.trunc(a.v / b.v);
        return { v, t: a.t || b.t };
      }
    }
  };
  const holds = (c: Cond): boolean => {
    switch (c.kind) {
      case 'bool': return c.value;
      case 'not': return !holds(c.arg);
      case 'and': return holds(c.left) && holds(c.right);
      case 'or': return holds(c.left) || holds(c.right);
      case 'cmp': {
        const a = ev(c.left).v, b = ev(c.right).v;
        return c.op === '<' ? a < b : c.op === '<=' ? a <= b : c.op === '>' ? a > b : c.op === '>=' ? a >= b : c.op === '==' ? a === b : a !== b;
      }
    }
  };
  const mark = (key: string) => {
    const r = seen.get(key) ?? {};
    for (const x of p.vars) if (env[x].t) r[x] = true;
    seen.set(key, r);
  };
  const exec = (ss: Stmt[]): void => {
    for (const s of ss) {
      if (--fuel < 0) throw new Error('fuel');
      if (s.kind === 'assign') { env[s.name] = ev(s.expr); mark(`after:${s.id}`); }
      else if (s.kind === 'assert') { if (!holds(s.cond)) throw new Error('assert'); mark(`after:${s.id}`); }
      else if (s.kind === 'if') { exec(holds(s.cond) ? s.then : s.else); mark(`exit:${s.id}`); }
      else { mark(`head:${s.id}`); while (holds(s.cond)) { exec(s.body); mark(`head:${s.id}`); } mark(`exit:${s.id}`); }
    }
  };
  try { exec(p.body); } catch { /* the states seen before stopping still count */ }
  return seen;
}

describe('taint', () => {
  const T = domainById('taint').domain;
  it('is sound for the labelled semantics on every example', () => {
    for (const ex of EXAMPLES) {
      const p = parse(ex.code);
      const a = analyze(p, T);
      for (const inputs of [[0, 0], [3, -2], [-1, 5], [7, 0], [-4, -4]]) {
        for (const [point, vars] of runTagged(ex.code, inputs)) {
          const s = a.states.get(point) as AEnv<[Interval, Taint]>;
          for (const x of Object.keys(vars)) expect(s?.[x][1], `${ex.id} ${point} ${x}`).toBe('tainted');
        }
      }
    }
  });

  it('follows data, not values', () => {
    const p = parse(example('taint').code);
    const a = analyze(p, T);
    const end = a.states.get(`after:${p.body.at(-1)!.id}`) as AEnv<[Interval, Taint]>;
    expect(end!.m[1]).toBe('clean');
    expect(end!.q[1]).toBe('clean');
    expect(end!.r[1]).toBe('tainted');
    expect(end!.z).toEqual([{ lo: -Infinity, hi: Infinity }, 'tainted']); // n - n is 0, yet tainted
  });

  it('misses implicit flows', () => {
    const p = parse(example('implicit-flow').code);
    const end = analyze(p, T).states.get(`after:${p.body.at(-1)!.id}`) as AEnv<[Interval, Taint]>;
    expect(end!.x[1]).toBe('clean');
    expect(end!.y[1]).toBe('clean');
  });

  it('alone, never restricts values', () => {
    expect(TaintDomain.contains('clean', 0)).toBe(true);
    expect(TaintDomain.binop('*', 'clean', 'tainted')).toBe('tainted');
  });
});

describe('disjunctive states', () => {
  const run = (id: string, k = 4) => {
    const p = parse(example(id).code);
    const L = disjunctive(abstractStates(IntervalDomain, p.vars), k);
    return { p, a: analyzeStates(p, L) };
  };

  it('are sound on every example', () => {
    for (const ex of EXAMPLES) {
      const { p, a } = run(ex.id);
      const c = collect(p, { range: 3, maxRuns: 400, fuel: 200 });
      for (const [point, envs] of c.states) {
        const cases = a.states.get(point) ?? [];
        for (const env of envs) {
          const ok = cases.some((s) => s && p.vars.every((x) => IntervalDomain.contains(s[x], env[x])));
          expect(ok, `${ex.id} ${point} ${JSON.stringify(env)}`).toBe(true);
        }
      }
    }
  });

  it('prove what one interval per variable cannot', () => {
    const p = parse(example('sign-split').code);
    expect(analyze(p, IntervalDomain).alarms.map((x) => x.message)).toEqual(['possible division by zero', 'assertion may fail']);
    expect(run('sign-split').a.alarms).toEqual([]);
    // With room for only one case, they are plain intervals again.
    expect(run('sign-split', 1).a.alarms.length).toBe(2);
  });

  it('are never less precise than intervals', () => {
    for (const ex of EXAMPLES) {
      const { p, a } = run(ex.id);
      const b = analyze(p, IntervalDomain);
      for (const [k, cases] of a.states) for (const x of p.vars) {
        const joined = cases.reduce((acc: Interval, s) => IntervalDomain.join(acc, s![x]), null);
        expect(IntervalDomain.leq(joined, b.states.get(k)?.[x] ?? null), `${ex.id} ${k} ${x}`).toBe(true);
      }
    }
  });
});
