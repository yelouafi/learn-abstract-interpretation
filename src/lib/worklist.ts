// The worklist algorithm: Kleene iteration that only recomputes what may have changed.
//
//   X[n] = ⊥ for every node;  worklist = { entry }
//   while the worklist is not empty:
//     take a node m out of it
//     new = ⊔ over the edges p → m of ⟦edge⟧ X[p]        (init for the entry)
//     if new is not below X[m]:
//       X[m] = X[m] ⊔ new        (or X[m] ∇ new at a widening point)
//       put every successor of m in the worklist
//
// Invariant: any node whose inputs changed since it was last computed is in the worklist.
// So when the worklist is empty, every equation holds: we have a (post-)fixpoint.

import { applyEdge, dfs, weakTopologicalOrder, type Cfg, type CfgEdge, type WtoElement } from './cfg';
import type { StateLattice } from './states';

export type Order = 'fifo' | 'rpo' | 'recursive';

export interface WorklistOptions {
  /**
   * fifo: first in, first out. rpo: always take the earliest node in reverse postorder.
   * recursive: no worklist; follow the weak topological order and stabilize each loop
   * completely (inner loops first, each with a fresh widening counter) — Bourdoncle's strategy.
   */
  order?: Order;
  /** Widen at widening points once they have changed this many times (null: never). */
  widenDelay?: number | null;
  /** Rounds of narrowing (over all nodes, in reverse postorder) after stabilization. */
  narrowSteps?: number;
  /** Safety net. */
  maxSteps?: number;
}

export interface WorklistStep<S> {
  node: string;
  phase: 'up' | 'down';
  before: S;
  after: S;
  changed: boolean;
  widened: boolean;
  /** Successors added to the worklist by this step. */
  added: string[];
  /** The worklist after this step. */
  worklist: string[];
}

export interface WorklistResult<S> {
  X: Map<string, S>;
  steps: WorklistStep<S>[];
  /** Nodes where widening is applied: the targets of DFS back edges. */
  wideningPoints: Set<string>;
  rpo: string[];
  stable: boolean;
}

export function worklistSolve<S>(cfg: Cfg, L: StateLattice<S>, opts: WorklistOptions = {}): WorklistResult<S> {
  const order = opts.order ?? 'rpo';
  const widenDelay = L.widen ? (opts.widenDelay ?? null) : null;
  const narrowSteps = opts.narrowSteps ?? 0;
  const maxSteps = opts.maxSteps ?? 5000;
  const same = (a: S, b: S) => L.leq(a, b) && L.leq(b, a);

  const { rpo, backEdges } = dfs(cfg);
  const rank = new Map(rpo.map((k, i) => [k, i]));
  const wideningPoints = new Set(backEdges.map((e) => e.to));
  const preds = new Map<string, CfgEdge[]>(cfg.nodes.map((n) => [n.key, []]));
  const succs = new Map<string, string[]>(cfg.nodes.map((n) => [n.key, []]));
  for (const e of cfg.edges) {
    preds.get(e.to)!.push(e);
    if (!succs.get(e.from)!.includes(e.to)) succs.get(e.from)!.push(e.to);
  }

  const X = new Map<string, S>(cfg.nodes.map((n) => [n.key, L.bottom]));
  const inputs = (m: string): S =>
    m === cfg.entry ? L.init : preds.get(m)!.reduce((acc, e) => L.join(acc, applyEdge(L, e, X.get(e.from)!)), L.bottom);

  const steps: WorklistStep<S>[] = [];
  const changes = new Map<string, number>();
  let worklist: string[] = [cfg.entry];

  if (order === 'recursive') {
    // Evaluate one node; at a loop head, widen once this component has gone round `widenDelay` times.
    const evalNode = (m: string, widenNow: boolean): boolean => {
      const before = X.get(m)!;
      let after = L.join(before, inputs(m));
      let widened = false;
      if (widenNow && widenDelay !== null && !same(after, before)) {
        const w = L.widen!(before, after);
        widened = !same(w, after);
        after = w;
      }
      const changed = !same(after, before);
      if (changed) X.set(m, after);
      steps.push({ node: m, phase: 'up', before, after, changed, widened, added: [], worklist: [] });
      return changed;
    };
    const run = (els: WtoElement[]) => {
      for (const el of els) {
        if (steps.length >= maxSteps) return;
        if ('node' in el) { evalNode(el.node, false); continue; }
        evalNode(el.head, false);
        for (let k = 0; steps.length < maxSteps; k++) {
          run(el.body);
          if (!evalNode(el.head, widenDelay !== null && k + 1 >= widenDelay)) break;
        }
      }
    };
    run(weakTopologicalOrder(cfg));
    worklist = steps.length >= maxSteps ? ['…'] : [];
  }

  // ---- ascending phase ----
  while (order !== 'recursive' && worklist.length && steps.length < maxSteps) {
    let m: string;
    if (order === 'fifo') m = worklist.shift()!;
    else {
      m = worklist.reduce((best, k) => (rank.get(k)! < rank.get(best)! ? k : best));
      worklist = worklist.filter((k) => k !== m);
    }
    const before = X.get(m)!;
    let after = L.join(before, inputs(m));
    let widened = false;
    if (widenDelay !== null && wideningPoints.has(m) && (changes.get(m) ?? 0) >= widenDelay && !same(after, before)) {
      const w = L.widen!(before, after);
      widened = !same(w, after);
      after = w;
    }
    const changed = !same(after, before);
    const added: string[] = [];
    if (changed) {
      X.set(m, after);
      changes.set(m, (changes.get(m) ?? 0) + 1);
      for (const s of succs.get(m)!) if (!worklist.includes(s)) { worklist.push(s); added.push(s); }
    }
    steps.push({ node: m, phase: 'up', before, after, changed, widened, added, worklist: [...worklist] });
  }
  const stable = worklist.length === 0;

  // ---- descending phase (narrowing), only if something was widened ----
  if (stable && steps.some((s) => s.widened)) {
    for (let round = 0; round < narrowSteps; round++) {
      let any = false;
      for (const m of rpo) {
        const before = X.get(m)!;
        let after = inputs(m);
        if (wideningPoints.has(m)) after = L.narrow ? L.narrow(before, after) : after;
        const changed = !same(after, before);
        if (changed) { X.set(m, after); any = true; }
        steps.push({ node: m, phase: 'down', before, after, changed, widened: false, added: [], worklist: [] });
      }
      if (!any) break;
    }
  }

  return { X, steps, wideningPoints, rpo, stable };
}
