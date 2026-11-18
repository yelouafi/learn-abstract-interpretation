// The concrete semantics of Tiny: an ordinary interpreter.
//
// Every variable starts at 0. `input()` returns the next value from an input source.
// Integer division truncates toward zero; dividing by zero is a runtime error.
//
// The interpreter records the state at every *program point* so that pages can
// display traces and so that the collecting semantics (sets of states) can be built
// by running the program on many inputs.

import type { Cond, Expr, Program, Stmt } from './ast';

export type Env = Record<string, number>;

/** A program point is where we observe the state. Displayed on `line`. */
export type PointKind = 'after' | 'head' | 'exit';
export interface Point { key: string; kind: PointKind; stmtId: number; line: number }

export function pointKey(kind: PointKind, stmtId: number) { return `${kind}:${stmtId}`; }

/**
 * Enumerate the program points of a program:
 *  - `after:id`  after an assignment or assert, shown on its line
 *  - `head:id`   at a loop head (each time the condition is tested), shown on the `while` line
 *  - `exit:id`   after an `if` or `while` finishes, shown on its closing-brace line
 */
export function programPoints(p: Program): Point[] {
  const out: Point[] = [];
  const walk = (ss: Stmt[]) => {
    for (const s of ss) {
      switch (s.kind) {
        case 'assign': case 'assert':
          out.push({ key: pointKey('after', s.id), kind: 'after', stmtId: s.id, line: s.line }); break;
        case 'if':
          walk(s.then); walk(s.else);
          out.push({ key: pointKey('exit', s.id), kind: 'exit', stmtId: s.id, line: s.endLine }); break;
        case 'while':
          out.push({ key: pointKey('head', s.id), kind: 'head', stmtId: s.id, line: s.line });
          walk(s.body);
          out.push({ key: pointKey('exit', s.id), kind: 'exit', stmtId: s.id, line: s.endLine }); break;
      }
    }
  };
  walk(p.body);
  return out;
}

export type RunStatus =
  | { kind: 'ok' }
  | { kind: 'assert-failed'; line: number }
  | { kind: 'error'; line: number; message: string }
  | { kind: 'out-of-fuel' };

export interface TraceStep { point: string; line: number; env: Env }
export interface RunResult { status: RunStatus; trace: TraceStep[]; inputsUsed: number[] }

class Halt { constructor(public status: RunStatus) {} }

export interface RunOptions {
  /** Called for each `input()`; receives how many inputs were read before. */
  input: (index: number) => number;
  /** Maximum number of loop iterations (all loops combined) before giving up. */
  fuel?: number;
}

export function run(p: Program, opts: RunOptions): RunResult {
  const env: Env = Object.fromEntries(p.vars.map((v) => [v, 0]));
  const trace: TraceStep[] = [];
  const inputsUsed: number[] = [];
  let fuel = opts.fuel ?? 10_000;

  const record = (point: string, line: number) => trace.push({ point, line, env: { ...env } });

  const evalE = (e: Expr): number => {
    switch (e.kind) {
      case 'num': return e.value;
      case 'var': return env[e.name];
      case 'input': { const v = opts.input(inputsUsed.length); inputsUsed.push(v); return v; }
      case 'neg': return -evalE(e.arg);
      case 'bin': {
        const a = evalE(e.left), b = evalE(e.right);
        switch (e.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/':
            if (b === 0) throw new Halt({ kind: 'error', line: e.line, message: 'division by zero' });
            return Math.trunc(a / b);
        }
      }
    }
  };

  const evalC = (c: Cond): boolean => {
    switch (c.kind) {
      case 'bool': return c.value;
      case 'not': return !evalC(c.arg);
      case 'and': return evalC(c.left) && evalC(c.right);
      case 'or': return evalC(c.left) || evalC(c.right);
      case 'cmp': {
        const a = evalE(c.left), b = evalE(c.right);
        switch (c.op) {
          case '<': return a < b;
          case '<=': return a <= b;
          case '>': return a > b;
          case '>=': return a >= b;
          case '==': return a === b;
          case '!=': return a !== b;
        }
      }
    }
  };

  const exec = (ss: Stmt[]) => {
    for (const s of ss) {
      switch (s.kind) {
        case 'assign':
          env[s.name] = evalE(s.expr);
          record(pointKey('after', s.id), s.line);
          break;
        case 'assert':
          if (!evalC(s.cond)) throw new Halt({ kind: 'assert-failed', line: s.line });
          record(pointKey('after', s.id), s.line);
          break;
        case 'if':
          exec(evalC(s.cond) ? s.then : s.else);
          record(pointKey('exit', s.id), s.endLine);
          break;
        case 'while':
          for (;;) {
            record(pointKey('head', s.id), s.line);
            if (!evalC(s.cond)) break;
            if (--fuel < 0) throw new Halt({ kind: 'out-of-fuel' });
            exec(s.body);
          }
          record(pointKey('exit', s.id), s.endLine);
          break;
      }
    }
  };

  try {
    exec(p.body);
    return { status: { kind: 'ok' }, trace, inputsUsed };
  } catch (e) {
    if (e instanceof Halt) return { status: e.status, trace, inputsUsed };
    throw e;
  }
}
