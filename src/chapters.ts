export interface Chapter {
  n: number;
  slug: string;
  title: string;
  blurb: string;
  ready: boolean;
}

export const CHAPTERS: Chapter[] = [
  { n: 1, slug: '01-why', title: 'Why approximate?', blurb: 'Programs have infinitely many behaviours. Testing samples them; abstract interpretation covers them all, at the price of false alarms.', ready: true },
  { n: 2, slug: '02-collecting', title: 'A tiny language and its collecting semantics', blurb: 'An interpreter, program points, and the set of all states a program can reach: the thing every analysis approximates.', ready: true },
  { n: 3, slug: '03-signs', title: 'Signs: your first abstract domain', blurb: 'A five-element lattice, abstract arithmetic, filtering on conditions, and a working analyzer.', ready: true },
  { n: 4, slug: '04-galois', title: 'Galois connections', blurb: 'α and γ as two functions you can write, and the recipe for the best abstract operator.', ready: false },
  { n: 5, slug: '05-fixpoints', title: 'Loops are fixpoints', blurb: 'Programs as equations, Kleene iteration, and why finite height guarantees termination.', ready: false },
  { n: 6, slug: '06-intervals', title: 'Intervals, widening and narrowing', blurb: 'An infinite lattice, an analysis that never stops, and the trick that forces it to.', ready: false },
  { n: 7, slug: '07-engine', title: 'Building a real analyzer', blurb: 'Control-flow graphs, worklists, and an engine parameterized by its domain.', ready: false },
  { n: 8, slug: '08-relational', title: 'Relational domains', blurb: 'Why intervals cannot prove x ≤ y: zones, octagons and polyhedra.', ready: false },
  { n: 9, slug: '09-beyond', title: 'Beyond numbers', blurb: 'Nullness, taint, pointers, and a tour of industrial analyzers.', ready: false },
];

export function url(path = '') {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}

export function chapterUrl(c: Chapter) {
  return url(`chapters/${c.slug}/`);
}
