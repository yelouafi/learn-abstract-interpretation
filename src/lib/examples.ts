// Example programs shared by the pages, the playground and the tests.

export interface Example { id: string; title: string; code: string }

export const EXAMPLES: Example[] = [
  {
    id: 'countdown',
    title: 'Countdown',
    code: `x = input();
y = 0;
while (x > 0) {
  x = x - 1;
  y = y + 2;
}
assert(y >= 0);
`,
  },
  {
    id: 'abs',
    title: 'Absolute value',
    code: `x = input();
if (x < 0) {
  y = -x;
} else {
  y = x;
}
assert(y >= 0);
`,
  },
  {
    id: 'product',
    title: 'Product of positives',
    code: `n = input();
if (n > 0) {
  r = 1;
  i = 1;
  while (i < n) {
    i = i + 1;
    r = r * i;
  }
  assert(r > 0);
}
`,
  },
  {
    id: 'division',
    title: 'Division alarms',
    code: `a = input();
b = input();
if (b > 0) {
  q = a / b;      // safe: b is positive here
}
r = a / b;        // b may be zero!
`,
  },
  {
    id: 'dead-code',
    title: 'Dead code',
    code: `x = input();
if (x > 0) {
  y = x * x;
  if (y < 0) {
    z = 1;        // never runs
  }
}
`,
  },
  {
    id: 'copy',
    title: 'Copy then subtract',
    code: `x = input();
y = x;
d = x - y;
assert(d == 0);
`,
  },
  {
    id: 'square',
    title: 'Squares are non-negative',
    code: `x = input();
y = x * x;
assert(y >= 0);
if (x > 0) {
  z = x * x;
  assert(z > 0);
}
`,
  },
  {
    id: 'count',
    title: 'Counting to 100',
    code: `x = 0;
while (x < 100) {
  x = x + 1;
}
assert(x == 100);
`,
  },
  {
    id: 'sum',
    title: 'Sum of the first n numbers',
    code: `n = input();
i = 0;
s = 0;
if (n > 0 && n <= 1000) {
  while (i < n) {
    i = i + 1;
    s = s + i;
  }
  assert(i == n);
  assert(s >= 0);
}
`,
  },
  {
    id: 'two-counters',
    title: 'Two counters in lockstep',
    code: `x = 0;
y = 0;
while (x < 10) {
  x = x + 1;
  y = y + 1;
}
assert(y == 10);
`,
  },
  {
    id: 'bounds',
    title: 'Index below length',
    code: `n = input();
i = 0;
while (i < n) {
  k = i;          // think: read a[k]
  assert(0 <= k && k < n);
  i = i + 1;
}
`,
  },
  {
    id: 'not-equal',
    title: 'Loop with !=',
    code: `x = 0;
while (x != 10) {
  x = x + 1;
}
assert(x == 10);
`,
  },
  {
    id: 'nested',
    title: 'Nested loops',
    code: `i = 0;
s = 0;
while (i < 10) {
  j = 0;
  while (j < i) {
    s = s + 1;
    j = j + 1;
  }
  i = i + 1;
}
assert(s >= 0);
`,
  },
  {
    id: 'forever',
    title: 'Counting forever',
    code: `x = 0;
while (true) {
  x = x + 1;
}
y = 1;            // never reached
`,
  },
  {
    id: 'two-inputs',
    title: 'Two inputs',
    code: `x = input();
y = input();
if (x > 0 && y > 0) {
  z = x * y;
} else {
  z = 0;
}
`,
  },
];

export function example(id: string): Example {
  const e = EXAMPLES.find((x) => x.id === id);
  if (!e) throw new Error(`unknown example ${id}`);
  return e;
}
