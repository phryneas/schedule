import { expectTypeOf } from "expect-type";
import { async, execute, makeSchedulable, sync } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

const sum = makeSchedulable(function* (
  values: number[],
): SchedulableIterable<number> {
  return values.reduce((total, value) => total + value, 0);
});

expectTypeOf(sum([1, 2, 3])).toEqualTypeOf<number>();
expectTypeOf(sync(sum)([1, 2, 3])).toEqualTypeOf<number>();
expectTypeOf(async(sum)([1, 2, 3])).toEqualTypeOf<Promise<number>>();
expectTypeOf(sync(sum)).parameters.toEqualTypeOf<[number[]]>();
expectTypeOf(async(sum)).parameters.toEqualTypeOf<[number[]]>();

makeSchedulable(function* (): SchedulableIterable<number> {
  const result = yield* execute(sum, undefined, [[1, 2, 3]]);
  expectTypeOf(result).toEqualTypeOf<number>();
  return result;
});

// @ts-expect-error Preserve the argument type of the original function.
sync(sum)("not an array");
// @ts-expect-error Preserve the argument type of the original function.
async(sum)("not an array");

const identity = makeSchedulable<
  <T>(value: T) => SchedulableIterable<T>,
  <T>(value: T) => T,
  <T>(value: T) => Promise<T>
>(function* <T>(value: T): SchedulableIterable<T> {
  return value;
});

expectTypeOf(sync(identity)(42)).toEqualTypeOf<number>();
expectTypeOf(sync(identity)(42 as const)).toEqualTypeOf<42>();

expectTypeOf(async(identity)("hello")).toEqualTypeOf<Promise<string>>();
