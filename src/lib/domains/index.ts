// Registry of the value domains the playground can run.

import type { ValueDomain } from '../domain';
import { SignDomain } from './sign';
import { Signs8Domain } from './signs8';
import { IntervalDomain } from './interval';

export interface DomainEntry { id: string; label: string; domain: ValueDomain<any> }

export const DOMAINS: DomainEntry[] = [
  { id: 'signs', label: 'Signs (5 elements)', domain: SignDomain },
  { id: 'signs8', label: 'Extended signs (8 elements)', domain: Signs8Domain },
  { id: 'intervals', label: 'Intervals', domain: IntervalDomain },
];

export function domainById(id: string): DomainEntry {
  const d = DOMAINS.find((x) => x.id === id);
  if (!d) throw new Error(`unknown domain ${id}`);
  return d;
}

/**
 * α on a finite set of integers, for any domain: the join of the abstractions of
 * its elements. This is correct whenever α comes from a Galois connection, because
 * α then preserves joins: α(S ∪ T) = α(S) ⊔ α(T).
 */
export function alphaOf<V>(D: ValueDomain<V>, ns: Iterable<number>): V {
  let v = D.bottom;
  for (const n of ns) v = D.join(v, D.fromConst(n));
  return v;
}
