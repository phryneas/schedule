# TODO

General Codemod README here


## Yield points in codemodded source

Use a standalone comment to mark where a function may pause:

```ts
export function sum(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
    // @phryneas/schedule may-yield-here
  }
  return total;
}
```

The codemod obtains the scheduling signal once per function and replaces each
directive with `if (signal.shouldYield) { yield* commands.yieldNow(); }`.
The comment must appear between statements inside a braced body; an empty body
or the end of a body also works. Directives in excluded functions, such as inline
callbacks, report an error.

Functions are wrapped only when the resulting body contains a yield, whether
from a directive or a call converted to `commands.execute`. A loop alone does
not cause wrapping.
