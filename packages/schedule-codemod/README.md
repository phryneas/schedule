# TODO

General Codemod README here

## Array loops

Opt into a `for…of` loop for a simple `.map()` or `.some()`:

```ts
// @phryneas/schedule transform-to-loop
return items.some(item => expensiveCheck(item));
```

Place the marker before a return or single-variable declaration inside a braced
body. Use an inline callback with one element parameter and either an expression
body or a single return statement. Ordinary function callbacks are supported
unless they access their own `this`, `arguments`, or `new.target`; arrows retain
their lexical bindings.

The marker assumes a dense ordinary array that is not structurally modified
during iteration. Index/array parameters, `thisArg`, async/generator callbacks,
explicit callback type annotations, reassigned parameters, and more complex
bodies are rejected.

Calls inside the callback undergo the normal scheduling transformation.
Scheduled calls check the deadline during async execution, so a loop that
reaches one on every iteration needs no additional checkpoint. For work that
does not reach a scheduled call, use `may-yield-here` inside the callback's braced
body to provide a checkpoint.

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
directive with `if (signal.shouldYield) { yield* commands.yieldNow; }`.
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
inside that function, overriding an enclosing `explicit` marker. It also works
before `export function` declarations. An `explicit` block inside the marked
function can still keep selected calls synchronous.
Use `may-yield-here` separately for loop checkpoints.
Async functions, existing generators, constructors, accessors, type guards,
and configured exclusions still cannot be opted in.

Use `// @phryneas/schedule explicit` at file scope to keep calls throughout the
file synchronous. At the start of a braced block, it applies only to that block
and its nested scopes. Add `may-yield-here` comments where you want to allow
the function to yield:

```ts
function work(items) {
  // @phryneas/schedule explicit
  for (const item of items) {
    // @phryneas/schedule may-yield-here
    process(item);
  }
}
```

Unless a function opts back in with `schedulable`, calls inside an explicit scope
run synchronously, including calls to schedulable functions. Those calls'
checkpoints do not suspend the outer scheduler.

Use `// @phryneas/schedule synchronous` immediately before a call, or a
return, assignment, or single-variable declaration whose value is a call, to
preserve that invocation without scheduling it:

```ts
// @phryneas/schedule synchronous
const result = callback.apply(visitor, args);
```

Only that invocation is excluded; calls in its arguments can still be scheduled.
Keep loop checkpoints around repeated synchronous calls. The marker does not
make a long-running callback interruptible.

Dynamic calls check the scheduling deadline before dispatch. Ordinary callbacks
are called directly; callbacks with the `schedulableImplementationSignal` marker go through
`commands.execute`, which checks whether they are schedulable. Known ordinary
and schedulable targets retain their direct and `.command` calls respectively.
