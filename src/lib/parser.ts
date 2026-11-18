// A hand-written lexer + recursive-descent parser for Tiny.
//
// Grammar:
//   program := stmt*
//   stmt    := IDENT '=' expr ';'
//            | 'if' '(' cond ')' block ('else' (block | ifStmt))?
//            | 'while' '(' cond ')' block
//            | 'assert' '(' cond ')' ';'
//   block   := '{' stmt* '}'
//   cond    := conj ('||' conj)*
//   conj    := cneg ('&&' cneg)*
//   cneg    := '!' cneg | '(' cond ')' | 'true' | 'false' | expr CMP expr
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := '-' unary | NUM | IDENT | 'input' '(' ')' | '(' expr ')'

import type { BinOp, CmpOp, Cond, Expr, Program, Stmt } from './ast';

export class ParseError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`Line ${line}:${col}: ${message}`);
  }
}

type TokKind = 'num' | 'ident' | 'kw' | 'op' | 'eof';
interface Token { kind: TokKind; text: string; line: number; col: number }

const KEYWORDS = new Set(['if', 'else', 'while', 'assert', 'input', 'true', 'false']);
const OPS = ['<=', '>=', '==', '!=', '&&', '||', '<', '>', '=', '+', '-', '*', '/', '(', ')', '{', '}', ';', '!'];

function lex(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0, line = 1, col = 1;
  const adv = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') { line++; col = 1; } else col++;
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { adv(1); continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') adv(1); continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new ParseError('unterminated comment', line, col);
      adv(end + 2 - i); continue;
    }
    const start = { line, col };
    if (/[0-9]/.test(c)) {
      let j = i; while (j < src.length && /[0-9]/.test(src[j])) j++;
      toks.push({ kind: 'num', text: src.slice(i, j), ...start }); adv(j - i); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const text = src.slice(i, j);
      toks.push({ kind: KEYWORDS.has(text) ? 'kw' : 'ident', text, ...start }); adv(j - i); continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ParseError(`unexpected character '${c}'`, line, col);
    toks.push({ kind: 'op', text: op, ...start }); adv(op.length);
  }
  toks.push({ kind: 'eof', text: '<end of input>', line, col });
  return toks;
}

export function parse(src: string): Program {
  const toks = lex(src);
  let pos = 0;
  let nextId = 0;
  const vars: string[] = [];
  const seeVar = (n: string) => { if (!vars.includes(n)) vars.push(n); };

  const peek = () => toks[pos];
  const at = (text: string) => (peek().kind === 'op' || peek().kind === 'kw') && peek().text === text;
  const fail = (msg: string, t = peek()): never => { throw new ParseError(msg, t.line, t.col); };
  const expect = (text: string) => {
    if (!at(text)) fail(`expected '${text}' but found '${peek().text}'`);
    return toks[pos++];
  };

  function block(): { stmts: Stmt[]; endLine: number } {
    expect('{');
    const stmts: Stmt[] = [];
    while (!at('}')) {
      if (peek().kind === 'eof') fail("expected '}'");
      stmts.push(stmt());
    }
    const close = expect('}');
    return { stmts, endLine: close.line };
  }

  function stmt(): Stmt {
    const t = peek();
    if (t.kind === 'ident') {
      pos++; seeVar(t.text);
      expect('=');
      const e = expr();
      expect(';');
      return { kind: 'assign', id: nextId++, line: t.line, name: t.text, expr: e };
    }
    if (at('if')) {
      pos++; const id = nextId++;
      expect('('); const c = cond(); expect(')');
      const th = block();
      let els: Stmt[] = [];
      let endLine = th.endLine;
      if (at('else')) {
        pos++;
        if (at('if')) { const s = stmt(); els = [s]; endLine = (s as { endLine: number }).endLine; }
        else { const b = block(); els = b.stmts; endLine = b.endLine; }
      }
      return { kind: 'if', id, line: t.line, endLine, cond: c, then: th.stmts, else: els };
    }
    if (at('while')) {
      pos++; const id = nextId++;
      expect('('); const c = cond(); expect(')');
      const b = block();
      return { kind: 'while', id, line: t.line, endLine: b.endLine, cond: c, body: b.stmts };
    }
    if (at('assert')) {
      pos++;
      expect('('); const c = cond(); expect(')'); expect(';');
      return { kind: 'assert', id: nextId++, line: t.line, cond: c };
    }
    return fail(`expected a statement but found '${t.text}'`);
  }

  function cond(): Cond {
    let l = conj();
    while (at('||')) { pos++; l = { kind: 'or', left: l, right: conj() }; }
    return l;
  }
  function conj(): Cond {
    let l = cneg();
    while (at('&&')) { pos++; l = { kind: 'and', left: l, right: cneg() }; }
    return l;
  }
  function cneg(): Cond {
    if (at('!')) { pos++; return { kind: 'not', arg: cneg() }; }
    if (at('true')) { pos++; return { kind: 'bool', value: true }; }
    if (at('false')) { pos++; return { kind: 'bool', value: false }; }
    if (at('(')) {
      // Either a parenthesized condition or a parenthesized expression starting a comparison.
      const save = pos;
      try {
        pos++;
        const c = cond();
        expect(')');
        if (!isCmpOp()) return c;
      } catch { /* fall through */ }
      pos = save;
    }
    const left = expr();
    if (!isCmpOp()) fail(`expected a comparison operator but found '${peek().text}'`);
    const op = toks[pos++].text as CmpOp;
    return { kind: 'cmp', op, left, right: expr() };
  }
  function isCmpOp() {
    return peek().kind === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(peek().text);
  }

  function expr(): Expr {
    let l = term();
    while (at('+') || at('-')) {
      const t = toks[pos++];
      l = { kind: 'bin', op: t.text as BinOp, left: l, right: term(), line: t.line };
    }
    return l;
  }
  function term(): Expr {
    let l = unary();
    while (at('*') || at('/')) {
      const t = toks[pos++];
      l = { kind: 'bin', op: t.text as BinOp, left: l, right: unary(), line: t.line };
    }
    return l;
  }
  function unary(): Expr {
    const t = peek();
    if (at('-')) {
      pos++;
      const arg = unary();
      return arg.kind === 'num' ? { kind: 'num', value: -arg.value } : { kind: 'neg', arg };
    }
    if (t.kind === 'num') { pos++; return { kind: 'num', value: Number(t.text) }; }
    if (t.kind === 'ident') { pos++; seeVar(t.text); return { kind: 'var', name: t.text, line: t.line }; }
    if (at('input')) { pos++; expect('('); expect(')'); return { kind: 'input', line: t.line }; }
    if (at('(')) { pos++; const e = expr(); expect(')'); return e; }
    return fail(`expected an expression but found '${t.text}'`);
  }

  const body: Stmt[] = [];
  while (peek().kind !== 'eof') body.push(stmt());
  return { body, vars };
}
