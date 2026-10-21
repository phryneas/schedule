import { expectTypeOf } from "expect-type";
import { async, commands, makeSchedulable } from "../src/index.ts";
import type { schedulableImplementationSignal } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

export const scheduled = makeSchedulable<{
  <X>(x: X): X;
  command: { <X>(x: X): SchedulableIterable<X> };
  [schedulableImplementationSignal]: {
    <X>(x: X): SchedulableIterable<X>;
    syncSignature?<X>(x: X): X;
    asyncSignature?<X>(x: X): Promise<Awaited<X>>;
  };
}>(function* <X>(x: X): SchedulableIterable<X> {
  return x;
});

expectTypeOf([1, 2, 3].map(scheduled)).toEqualTypeOf<number[]>();
expectTypeOf(scheduled(1)).toEqualTypeOf<number>();
expectTypeOf(async(scheduled)(1)).toEqualTypeOf<Promise<number>>();
expectTypeOf(commands.execute(scheduled)(1)).toEqualTypeOf<SchedulableIterable<number>>();
expectTypeOf(scheduled.command(1)).toEqualTypeOf<SchedulableIterable<number>>();
