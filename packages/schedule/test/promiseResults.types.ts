import { expectTypeOf } from "expect-type";
import { async, commands, makeSchedulable, sync } from "../src/index.ts";
import type { SchedulableIterable, SchedulableMethod, schedulableImplementationSymbol as key } from "../src/index.ts";

const child = makeSchedulable(function* (value: number) {
  return Promise.resolve(value);
});
expectTypeOf(child(42)).toEqualTypeOf<Promise<number>>();
expectTypeOf(sync(child.schedulable(42))).toEqualTypeOf<Promise<number>>();
expectTypeOf(async(child.schedulable(42))).toEqualTypeOf<Promise<number>>();
expectTypeOf(child.schedulable(42)).toEqualTypeOf<SchedulableIterable<Promise<number>>>();
expectTypeOf(commands.execute(child)(42)).toEqualTypeOf<SchedulableIterable<Promise<number>>>();
expectTypeOf(commands.execute((value: number) => Promise.resolve(value))(42))
  .toEqualTypeOf<SchedulableIterable<Promise<number>>>();

makeSchedulable(function* () {
  const first = yield* child.schedulable(1);
  const second = yield* commands.execute(child)(2);
  expectTypeOf(first).toEqualTypeOf<Promise<number>>();
  expectTypeOf(second).toEqualTypeOf<Promise<number>>();
  return Promise.all([first, second]);
});

const mixed = makeSchedulable(function* (value: number | Promise<number>) {
  return value;
});
expectTypeOf(sync(mixed.schedulable(1))).toEqualTypeOf<number | Promise<number>>();
expectTypeOf(async(mixed.schedulable(1))).toEqualTypeOf<Promise<number>>();
expectTypeOf(mixed.schedulable(1)).toEqualTypeOf<SchedulableIterable<number | Promise<number>>>();

declare const nested: PromiseLike<PromiseLike<number>>;
const thenable = makeSchedulable(function* () { return nested; });
expectTypeOf(sync(thenable.schedulable())).toEqualTypeOf<typeof nested>();
expectTypeOf(async(thenable.schedulable())).toEqualTypeOf<Promise<number>>();
expectTypeOf(thenable.schedulable()).toEqualTypeOf<SchedulableIterable<typeof nested>>();

declare const method: SchedulableMethod<(this: { value: number }, increment: number) => Promise<number>>;
expectTypeOf(async(method.schedulable.call({ value: 1 }, 2))).toEqualTypeOf<Promise<number>>();
expectTypeOf(sync(method.schedulable.call({ value: 1 }, 2))).toEqualTypeOf<Promise<number>>();
expectTypeOf(method.schedulable.call({ value: 1 }, 2)).toEqualTypeOf<SchedulableIterable<Promise<number>>>();
// @ts-expect-error Promise result normalization must preserve the receiver type.
async(method.schedulable.call({ value: "wrong" }, 2));
// @ts-expect-error Promise result normalization must preserve parameter checking.
async(child.schedulable("wrong"));

type Identity = {
  <T>(value: T): T;
  schedulable: Identity[typeof key];
  [key]: {
    <T>(value: T): SchedulableIterable<T>;
  };
};
const identity = makeSchedulable<Identity>(function* <T>(value: T): SchedulableIterable<T> {
  return value;
});
expectTypeOf(async(identity.schedulable(Promise.resolve(42)))).toEqualTypeOf<Promise<number>>();
expectTypeOf(async(identity.schedulable(nested))).toEqualTypeOf<Promise<number>>();
expectTypeOf(sync(identity.schedulable(nested))).toEqualTypeOf<typeof nested>();
expectTypeOf(identity.schedulable(nested)).toEqualTypeOf<SchedulableIterable<typeof nested>>();
expectTypeOf(commands.execute(identity)(nested)).toEqualTypeOf<SchedulableIterable<typeof nested>>();
