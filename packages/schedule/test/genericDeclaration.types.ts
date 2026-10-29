import { expectTypeOf } from "expect-type";
import { async, commands, makeSchedulable } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

export const scheduled = makeSchedulable<{
  <X>(x: X): X;
  schedulable: {
    <X>(x: X): SchedulableIterable<X>;
  };
}>(function* <X>(x: X): SchedulableIterable<X> {
  return x;
});

expectTypeOf([1, 2, 3].map(scheduled)).toEqualTypeOf<number[]>();
expectTypeOf(scheduled(1)).toEqualTypeOf<number>();
expectTypeOf(async(scheduled.schedulable(1))).toEqualTypeOf<Promise<number>>();
expectTypeOf(commands.execute(scheduled)(1)).toEqualTypeOf<SchedulableIterable<number>>();
expectTypeOf(scheduled.schedulable(1)).toEqualTypeOf<SchedulableIterable<number>>();
