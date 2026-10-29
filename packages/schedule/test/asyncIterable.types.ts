import { expectTypeOf } from "expect-type";
import { async, makeSchedulable, yieldNow } from "../src/index.ts";

function* work() {
  yield* yieldNow;
  return 42;
}
function* promised() { return Promise.resolve(42); }
expectTypeOf(async(work())).toEqualTypeOf<Promise<number>>();
expectTypeOf(async(promised())).toEqualTypeOf<Promise<number>>();
const schedulable = makeSchedulable(function* (value: string) { return value; });
expectTypeOf(async(schedulable.schedulable("value"))).toEqualTypeOf<Promise<string>>();

// @ts-expect-error Only scheduling commands can be yielded.
async((function* () { yield 42; })());
// @ts-expect-error Ordinary collections are not scheduling generators.
async([1, 2, 3]);
