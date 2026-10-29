import { expectTypeOf } from "expect-type";
import { sync, makeSchedulable, yieldNow } from "../src/index.ts";

function* work() {
  yield* yieldNow;
  return 42;
}
function* promised() { return Promise.resolve(42); }
expectTypeOf(sync(work())).toEqualTypeOf<number>();
expectTypeOf(sync(promised())).toEqualTypeOf<Promise<number>>();
const schedulable = makeSchedulable(function* (value: string) { return value; });
expectTypeOf(sync(schedulable.schedulable("value"))).toEqualTypeOf<string>();

// @ts-expect-error Only scheduling commands can be yielded.
sync((function* () { yield 42; })());
// @ts-expect-error Ordinary collections are not scheduling generators.
sync([1, 2, 3]);
