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
| 4 | Galois connections | planned |
| 5 | Loops are fixpoints | planned |
| 6 | Intervals, widening and narrowing | planned |
| 7 | Building a real analyzer (CFG, worklist) | planned |
| 8 | Relational domains | planned |
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
  domains/sign.ts   the sign domain
  analyzer.ts       generic abstract interpreter (if → join, while → fixpoint)
  soundness.ts      checks analysis results against testing
  examples.ts       example programs used by pages and tests
src/scripts/        browser code: CodeMirror editor, <ai-playground> element
src/components/     Playground, SignLattice, SignTables, Insight, Exercise, …
src/pages/          the site (chapters are MDX with KaTeX math)
```

To add a domain: implement `ValueDomain<V>` in `src/lib/domains/`, add it to the
soundness test in `src/lib/lib.test.ts`, and add a mode to the playground.

## Deployment

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to
`main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.
