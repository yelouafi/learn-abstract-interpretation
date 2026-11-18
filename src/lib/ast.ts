// AST for "Tiny": the small imperative language used throughout the site.
//
//   x = input();                 // an unknown integer
//   y = 0;
//   while (x > 0) { x = x - 1; y = y + 2; }
//   if (y >= 0) { z = 1; } else { z = -1; }
//   assert(y >= 0);

export type BinOp = '+' | '-' | '*' | '/';
export type CmpOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string; line: number }
  | { kind: 'input'; line: number }
  | { kind: 'neg'; arg: Expr }
  | { kind: 'bin'; op: BinOp; left: Expr; right: Expr; line: number };

export type Cond =
  | { kind: 'cmp'; op: CmpOp; left: Expr; right: Expr }
  | { kind: 'and'; left: Cond; right: Cond }
  | { kind: 'or'; left: Cond; right: Cond }
  | { kind: 'not'; arg: Cond }
  | { kind: 'bool'; value: boolean };

export type Stmt =
  | { kind: 'assign'; id: number; line: number; name: string; expr: Expr }
  | { kind: 'if'; id: number; line: number; endLine: number; cond: Cond; then: Stmt[]; else: Stmt[] }
  | { kind: 'while'; id: number; line: number; endLine: number; cond: Cond; body: Stmt[] }
  | { kind: 'assert'; id: number; line: number; cond: Cond };

export interface Program {
  body: Stmt[];
  /** All variable names, in order of first appearance. */
  vars: string[];
}

export function negateCmp(op: CmpOp): CmpOp {
  switch (op) {
    case '<': return '>=';
    case '<=': return '>';
    case '>': return '<=';
    case '>=': return '<';
    case '==': return '!=';
    case '!=': return '==';
  }
}

/** Flip a comparison so that `a op b` becomes `b flip(op) a`. */
export function flipCmp(op: CmpOp): CmpOp {
  switch (op) {
    case '<': return '>';
    case '<=': return '>=';
    case '>': return '<';
    case '>=': return '<=';
    default: return op;
  }
}

/** Push negations down to comparisons (De Morgan), so analyzers only see positive conditions. */
export function negate(c: Cond): Cond {
  switch (c.kind) {
    case 'cmp': return { ...c, op: negateCmp(c.op) };
    case 'and': return { kind: 'or', left: negate(c.left), right: negate(c.right) };
    case 'or': return { kind: 'and', left: negate(c.left), right: negate(c.right) };
    case 'not': return c.arg;
    case 'bool': return { kind: 'bool', value: !c.value };
  }
}

export function showExpr(e: Expr): string {
  switch (e.kind) {
    case 'num': return String(e.value);
    case 'var': return e.name;
    case 'input': return 'input()';
    case 'neg': return `-${showExpr(e.arg)}`;
    case 'bin': return `(${showExpr(e.left)} ${e.op} ${showExpr(e.right)})`;
  }
}

export function showCond(c: Cond): string {
  switch (c.kind) {
    case 'cmp': return `${showExpr(c.left)} ${c.op} ${showExpr(c.right)}`;
    case 'and': return `(${showCond(c.left)} && ${showCond(c.right)})`;
    case 'or': return `(${showCond(c.left)} || ${showCond(c.right)})`;
    case 'not': return `!${showCond(c.arg)}`;
    case 'bool': return String(c.value);
  }
}
