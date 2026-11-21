// Control-flow graphs.
//
// A CFG has one node per program point (the same points as everywhere else on the site:
// after each statement, loop heads, and the end of each if/while, plus the program start).
// An edge says how execution moves from one point to the next, as a short list of actions:
//
//   assign:  x = e            assume:  [c]   (continue only if c holds)
//
// For example, the loop `while (x > 0) { x = x - 1; }` gives the edges
//
//   head --[x > 0]; x = x - 1--> after(x = x - 1)       (enter the body)
//   after(x = x - 1) ----------> head                    (back edge)
//   head --[x <= 0]-----------> exit                     (leave the loop)
//
// Real analyzers work on CFGs rather than syntax trees: break, continue, goto, exceptions
// and function returns all become ordinary edges.

import { negate, showCond, showExpr, type Cond, type Expr, type Program, type Stmt } from './ast';
import { pointKey, programPoints, type PointKind } from './interp';
import type { StateLattice } from './states';

export type Action =
  | { kind: 'assign'; x: string; e: Expr }
  | { kind: 'assume'; c: Cond };

export interface CfgNode {
  key: string;
  /** X0, X1, … as in chapter 5 */
  name: string;
  /** Source line where the point is displayed (0 for the program start). */
  line: number;
  kind: PointKind | 'entry';
}

export interface CfgEdge { from: string; to: string; actions: Action[] }

export interface Cfg {
  nodes: CfgNode[];
  edges: CfgEdge[];
  entry: string;
}

export const ENTRY = 'entry';

export function buildCfg(p: Program): Cfg {
  const nodes: CfgNode[] = [{ key: ENTRY, name: 'X0', line: 0, kind: 'entry' }];
  programPoints(p).forEach((pt, i) => nodes.push({ key: pt.key, name: `X${i + 1}`, line: pt.line, kind: pt.kind }));
  const edges: CfgEdge[] = [];

  // `at` is where control currently is; `pending` are actions not yet attached to an edge
  // (for example the test [c] at the start of a branch, before its first statement).
  interface Pos { at: string; pending: Action[] }
  const edge = (pos: Pos, to: string, ...more: Action[]) => edges.push({ from: pos.at, to, actions: [...pos.pending, ...more] });

  const block = (ss: Stmt[], pos: Pos): Pos => {
    for (const s of ss) pos = stmt(s, pos);
    return pos;
  };

  const stmt = (s: Stmt, pos: Pos): Pos => {
    switch (s.kind) {
      case 'assign': {
        const to = pointKey('after', s.id);
        edge(pos, to, { kind: 'assign', x: s.name, e: s.expr });
        return { at: to, pending: [] };
      }
      case 'assert': {
        const to = pointKey('after', s.id);
        edge(pos, to, { kind: 'assume', c: s.cond });
        return { at: to, pending: [] };
      }
      case 'if': {
        const exit = pointKey('exit', s.id);
        const t = block(s.then, { at: pos.at, pending: [...pos.pending, { kind: 'assume', c: s.cond }] });
        const e = block(s.else, { at: pos.at, pending: [...pos.pending, { kind: 'assume', c: negate(s.cond) }] });
        edge(t, exit);
        edge(e, exit);
        return { at: exit, pending: [] };
      }
      case 'while': {
        const head = pointKey('head', s.id);
        edge(pos, head);
        const body = block(s.body, { at: head, pending: [{ kind: 'assume', c: s.cond }] });
        edge(body, head); // the back edge
        const exit = pointKey('exit', s.id);
        edge({ at: head, pending: [] }, exit, { kind: 'assume', c: negate(s.cond) });
        return { at: exit, pending: [] };
      }
    }
  };

  block(p.body, { at: ENTRY, pending: [] });
  return { nodes, edges, entry: ENTRY };
}

export function showAction(a: Action): string {
  return a.kind === 'assign' ? `${a.x} = ${showExpr(a.e)}` : `[${showCond(a.c)}]`;
}

export function showEdge(e: CfgEdge): string {
  return e.actions.length ? e.actions.map(showAction).join('; ') : 'skip';
}

/** Run an edge's actions on a state. */
export function applyEdge<S>(L: StateLattice<S>, e: CfgEdge, s: S): S {
  for (const a of e.actions) s = a.kind === 'assign' ? L.assign(s, a.x, a.e) : L.filter(s, a.c);
  return s;
}

/**
 * Depth-first search from the entry. Returns the nodes in reverse postorder (an order in
 * which every node comes after its predecessors, ignoring back edges) and the back edges
 * (edges to a node that is still on the DFS stack). Every cycle contains a back edge.
 */
export function dfs(cfg: Cfg): { rpo: string[]; backEdges: CfgEdge[] } {
  const succ = new Map<string, CfgEdge[]>(cfg.nodes.map((n) => [n.key, []]));
  for (const e of cfg.edges) succ.get(e.from)!.push(e);
  const state = new Map<string, 'open' | 'done'>();
  const post: string[] = [];
  const backEdges: CfgEdge[] = [];
  const visit = (n: string) => {
    state.set(n, 'open');
    for (const e of succ.get(n)!) {
      const s = state.get(e.to);
      if (s === 'open') backEdges.push(e);
      else if (!s) visit(e.to);
    }
    state.set(n, 'done');
    post.push(n);
  };
  visit(cfg.entry);
  return { rpo: post.reverse(), backEdges };
}

/**
 * A weak topological order (Bourdoncle): the nodes in reverse postorder, with every loop
 * grouped into a component (its head, then its body, nested loops inside as components).
 * For `a; while (h) { b; while (h2) { c; } }` it is:  a  (h  b  (h2  c))
 */
export type WtoElement = { node: string } | { head: string; body: WtoElement[] };

export function weakTopologicalOrder(cfg: Cfg): WtoElement[] {
  const { rpo, backEdges } = dfs(cfg);
  const preds = new Map<string, string[]>(cfg.nodes.map((n) => [n.key, []]));
  for (const e of cfg.edges) preds.get(e.to)!.push(e.from);
  // Natural loop of each head: the head plus every node that reaches a back-edge source without passing the head.
  const loops = new Map<string, Set<string>>();
  for (const be of backEdges) {
    const body = loops.get(be.to) ?? new Set([be.to]);
    const stack = [be.from];
    while (stack.length) {
      const n = stack.pop()!;
      if (body.has(n)) continue;
      body.add(n);
      stack.push(...preds.get(n)!);
    }
    loops.set(be.to, body);
  }
  const build = (allowed: Set<string>): WtoElement[] => {
    const out: WtoElement[] = [];
    const placed = new Set<string>();
    for (const n of rpo) {
      if (!allowed.has(n) || placed.has(n)) continue;
      const loop = loops.get(n);
      if (loop) {
        const inner = new Set([...loop].filter((k) => k !== n && allowed.has(k)));
        // Inner heads are handled recursively: drop this head's loop from the map while building inside.
        loops.delete(n);
        out.push({ head: n, body: build(inner) });
        loops.set(n, loop);
        for (const k of loop) placed.add(k);
      } else {
        out.push({ node: n });
        placed.add(n);
      }
    }
    return out;
  };
  return build(new Set(rpo));
}

export function showWto(w: WtoElement[], name: (k: string) => string): string {
  return w.map((e) => ('node' in e ? name(e.node) : `(${name(e.head)} ${showWto(e.body, name)})`)).join(' ');
}
