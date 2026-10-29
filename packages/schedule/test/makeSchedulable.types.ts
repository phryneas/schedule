import { expectTypeOf } from "expect-type";
import { async, execute, getSignal, makeSchedulable, sync, yieldNow } from "../src/index.ts";
import type { ScheduleSignal } from "../src/types.ts";
import type { SchedulableIterable } from "../src/index.ts";

const sum = makeSchedulable(function* (
  values: number[],
): SchedulableIterable<number> {
  return values.reduce((total, value) => total + value, 0);
});

expectTypeOf(sum([1, 2, 3])).toEqualTypeOf<number>();
expectTypeOf(sync(sum.schedulable([1, 2, 3]))).toEqualTypeOf<number>();
expectTypeOf(async(sum.schedulable([1, 2, 3]))).toEqualTypeOf<Promise<number>>();
expectTypeOf(sum.schedulable).parameters.toEqualTypeOf<[number[]]>();
// @ts-expect-error Schedulers accept iterables, not functions.
sync(sum);
// @ts-expect-error Schedulers accept iterables, not functions.
async(sum);

declare const abortSignal: AbortSignal;
declare const scheduleSignal: ScheduleSignal;
expectTypeOf(async(sum.schedulable([1]), { signal: abortSignal, startImmediately: false }))
  .toEqualTypeOf<Promise<number>>();
expectTypeOf(async(sum.schedulable([1]), { signal: scheduleSignal, startImmediately: true }))
  .toEqualTypeOf<Promise<number>>();
expectTypeOf(async(sum.schedulable([1]), {})).toEqualTypeOf<Promise<number>>();
// @ts-expect-error Signals must be passed inside the options object.
async(sum.schedulable([]), abortSignal);
// @ts-expect-error startImmediately must be a boolean.
async(sum.schedulable([]), { startImmediately: "false" });

makeSchedulable(function* (): SchedulableIterable<number> {
  expectTypeOf(yield* yieldNow).toEqualTypeOf<void>();
  const signal = yield* getSignal;
  expectTypeOf(signal).toEqualTypeOf<ScheduleSignal>();
  const result = yield* execute(sum)([1, 2, 3]);
  expectTypeOf(result).toEqualTypeOf<number>();
  return result;
});

// @ts-expect-error Preserve the argument type of the original function.
sync(sum.schedulable("not an array"));
// @ts-expect-error Preserve the argument type of the original function.
async(sum.schedulable("not an array"));

const identity = makeSchedulable<{
  <T>(value: T): T;
  schedulable: {
    <T>(value: T): SchedulableIterable<T>;
  };
}>(function* <T>(value: T): SchedulableIterable<T> {
  return value;
});

expectTypeOf(sync(identity.schedulable(42))).toEqualTypeOf<number>();
expectTypeOf(sync(identity.schedulable(42 as const))).toEqualTypeOf<42>();

expectTypeOf(async(identity.schedulable("hello"))).toEqualTypeOf<Promise<string>>();

expectTypeOf(execute(identity)(42)).toEqualTypeOf<SchedulableIterable<number>>();
