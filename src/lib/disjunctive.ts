// Disjunctive states: keep up to k abstract states side by side instead of joining them
// (chapter 9). A state is a list of non-⊥ states of an underlying lattice L, read as "or".
//
// Joining two lists concatenates them, so the two branches of an `if` stay separate.
// Past k cases, everything is joined into one, as before. Loops use widening, which
// joins everything too: disjunctions mostly help between branches and the code after them.

import type { Alarm, StateLattice } from './states';

export type Disj<S> = S[];

export function disjunctive<S>(L: StateLattice<S>, k = 4): StateLattice<Disj<S>> & { collapse(s: Disj<S>): S } {
  const clean = (xs: S[]) => xs.filter((x) => !L.isBottom(x));
  const collapse = (xs: S[]): S => xs.reduce((acc, x) => L.join(acc, x), L.bottom);
  /** Remove cases already covered by another case; past k cases, join them all. */
  const normalize = (xs: S[]): S[] => {
    const out: S[] = [];
    for (const x of clean(xs)) {
      if (out.some((y) => L.leq(x, y))) continue;
      for (let i = out.length - 1; i >= 0; i--) if (L.leq(out[i], x)) out.splice(i, 1);
      out.push(x);
    }
    return out.length > k ? [collapse(out)] : out;
  };
  const one = (x: S): S[] => (L.isBottom(x) ? [] : [x]);

  return {
    bottom: [],
    init: [L.init],
    isBottom: (s) => s.length === 0,
    // Sound: every case of a is covered by some case of b.
    leq: (a, b) => a.every((x) => b.some((y) => L.leq(x, y))),
    join: (a, b) => normalize([...a, ...b]),
    widen: L.widen && ((a, b) => (a.length === 0 ? normalize(b) : one(L.widen!(collapse(a), collapse(b))))),
    narrow: L.narrow && ((a, b) => (a.length === 0 || b.length === 0 ? [] : one(L.narrow!(collapse(a), collapse(b))))),
    assign(s, x, e, report, stmtId) {
      // Each case is evaluated separately. A division is an error only if it fails in
      // every case, and a warning if it may fail in at least one.
      const reports: Alarm[][] = [];
      const out = s.map((c) => { const r: Alarm[] = []; const v = L.assign(c, x, e, r, stmtId); reports.push(r); return v; });
      if (report) {
        const flagged = reports.filter((r) => r.length > 0);
        if (flagged.length) {
          const all = flagged.length === s.length && flagged.every((r) => r.some((a) => a.severity === 'error'));
          const a = flagged[0][0];
          report.push({ ...a, severity: all ? 'error' : 'warning', message: all ? 'division by zero' : 'possible division by zero' });
        }
      }
      return normalize(out);
    },
    filter: (s, c) => normalize(s.map((x) => L.filter(x, c))),
    showVar: (s, x) => (s.length ? s.map((c) => L.showVar(c, x)).join(' ∨ ') : '⊥'),
    collapse,
  };
}
