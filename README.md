# Learn Abstract Interpretation

A hands-on course on abstract interpretation for programmers. You build a static
analyzer for a tiny language one idea at a time, with interactive playgrounds and
"math insight" boxes that state the key definitions and theorems without proofs.

## Status

| # | Chapter | Status |
|---|---------|--------|
| 1 | Why approximate? | ✅ |
| 2 | A tiny language and its collecting semantics | ✅ |
| 3 | Signs: your first abstract domain | ✅ |
| 4 | Galois connections | ✅ |
| 5 | Loops are fixpoints | ✅ |
| 6 | Intervals, widening and narrowing | ✅ |
| 7 | Building a real analyzer (CFG, worklist) | ✅ |
| 8 | Relational domains | ✅ |
| 9 | Beyond numbers | planned |

## Development

Requires Node 22.23.4 or later.

```sh
npm install
npm run dev      # local site at http://localhost:4321/learn-abstract-interpretation/
npm test         # analyzer unit tests (vitest)
npm run check    # type-check the analyzer and browser scripts
npm run build    # static site in dist/
```

## Layout

```
src/lib/            the analyzer, framework-free TypeScript with tests
  parser.ts         Tiny lexer + recursive-descent parser
  interp.ts         concrete interpreter, program points, traces
  collecting.ts     collecting semantics by exhaustive testing on small inputs
  domain.ts         ValueDomain interface (lattice + abstract operators)
  domains/sign.ts   the 5-element sign domain
  domains/signs8.ts the 8-element extended sign domain
  domains/interval.ts intervals, with widening and narrowing
  domains/parity.ts parity (even/odd)
  domains/index.ts  domain registry, generic α
  states.ts         state lattices: concrete sets of states, abstract environments
  analyzer.ts       generic abstract interpreter (if → join, while → fixpoint)
  equations.ts      programs as equation systems, Kleene iteration
  cfg.ts            control-flow graphs, DFS, weak topological order
  worklist.ts       worklist and recursive (Bourdoncle) solvers
  soundness.ts      checks analysis results against testing
  examples.ts       example programs used by pages and tests
src/scripts/        browser code: CodeMirror editor, <ai-playground> element
src/components/     Playground, SignLattice, SignTables, Insight, Exercise, …
src/pages/          the site (chapters are MDX with KaTeX math)
```

To add a domain: implement `ValueDomain<V>` in `src/lib/domains/`, add it to the
law and soundness tests in `src/lib/domains.test.ts`, and register it in
`src/lib/domains/index.ts` so the playground's domain picker can use it.

## Deployment

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to
`main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.
