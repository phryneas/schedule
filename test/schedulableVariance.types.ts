import { expectTypeOf } from "expect-type";
import { async, commands, makeSchedulable, sync } from "../src/index.ts";
import type { SchedulableFunction, SchedulableIterable, SchedulableMethod } from "../src/index.ts";

type Mutable = Map<string, number>;
type ReadonlyValue = ReadonlyMap<string, number>;
declare const fn: SchedulableFunction<Mutable, [value: Mutable]>;
// @ts-expect-error Ordinary functions must retain strict parameter variance.
const widenedFunction: SchedulableFunction<ReadonlyValue, [value: ReadonlyValue]> = fn;

declare const method: SchedulableMethod<(value: Mutable) => Mutable>;
const widenedMethod: SchedulableMethod<(value: ReadonlyValue) => ReadonlyValue> = method;

type Receiver = { total: number };
const add = makeSchedulable<SchedulableMethod<(this: Receiver, amount: number) => number>>(
  function* (this: Receiver, amount: number): SchedulableIterable<number> {
    return this.total + amount;
  },
);
const receiver: Receiver = { total: 1 };
expectTypeOf(add.call(receiver, 2)).toEqualTypeOf<number>();
expectTypeOf(sync(add).bind(receiver)(2)).toEqualTypeOf<number>();
expectTypeOf(async(add).bind(receiver)(2)).toEqualTypeOf<Promise<number>>();
expectTypeOf(commands.execute(add).bind(receiver)(2)).toEqualTypeOf<SchedulableIterable<number>>();
// @ts-expect-error Method bivariance does not permit invalid arguments.
add.call(receiver, "wrong");
// @ts-expect-error The explicit receiver remains checked.
commands.execute(add).bind({ total: "wrong" })(2);

declare const optionalRest: SchedulableMethod<
  (this: Receiver, label?: string, ...values: number[]) => string
>;
expectTypeOf(optionalRest.bind(receiver)()).toEqualTypeOf<string>();
expectTypeOf(commands.execute(optionalRest).bind(receiver)("sum", 1, 2))
  .toEqualTypeOf<SchedulableIterable<string>>();
expectTypeOf<Parameters<typeof optionalRest>>()
  .toEqualTypeOf<Parameters<(label?: string, ...values: number[]) => string>>();
// @ts-expect-error Rest argument types remain checked.
optionalRest.bind(receiver)("sum", "wrong");
