# TODO

General Codemod README here

## Type import resolution

Set `typeImportResolutionMode: "import"` to add
`with { "resolution-mode": "import" }` to generated type imports from the
scheduler runtime. `"require"` is also supported. The option is omitted by
default and does not change runtime imports.

When enabled, simple functions also receive a `SchedulableFunction` annotation
so TypeScript's declaration emitter uses that attributed import instead of
introducing an inline import without a resolution mode. Project transforms
obtain signatures from TypeScript; standalone `transformSource` calls need
explicit return annotations for this step.


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

To explicitly make an inline callback or returned-object method schedulable,
put this comment immediately before the function:

```ts
return {
  // @phryneas/schedule schedulable
  Field(node) {
    processField(node);
  },
};
```

This forces wrapping even without a yield and enables normal call rewriting
inside that function. Use `may-yield-here` separately for loop checkpoints.
Async functions, existing generators, constructors, accessors, type guards,
and configured exclusions still cannot be opted in.
