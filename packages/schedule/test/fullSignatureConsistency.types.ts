import { expectTypeOf } from "expect-type";
import { async, commands, makeSchedulable, sync } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

type Identity = {
  <T>(value: T): T;
  schedulable: {
    <T>(value: T): SchedulableIterable<T>;
  };
};
const identity = makeSchedulable<Identity>(function* <T>(value: T): SchedulableIterable<T> {
  return value;
});
expectTypeOf([1, 2, 3].map(identity)).toEqualTypeOf<number[]>();
expectTypeOf(identity(42)).toEqualTypeOf<number>();
expectTypeOf(sync(identity.schedulable(42))).toEqualTypeOf<number>();
expectTypeOf(async(identity.schedulable(42))).toEqualTypeOf<Promise<number>>();
expectTypeOf(commands.execute(identity)(42)).toEqualTypeOf<SchedulableIterable<number>>();
expectTypeOf(identity.schedulable(42)).toEqualTypeOf<SchedulableIterable<number>>();
expectTypeOf(identity.schedulable("value")).toEqualTypeOf<SchedulableIterable<string>>();

declare const wrongReturnImpl: <T>(value: T) => SchedulableIterable<string>;
// @ts-expect-error The implementation must preserve the declared generic return type.
makeSchedulable<Identity>(wrongReturnImpl);

declare const wrongArgumentImpl: (value: string) => SchedulableIterable<string>;
// @ts-expect-error The implementation must accept every declared generic argument.
makeSchedulable<Identity>(wrongArgumentImpl);

type NotCallable = { schedulable: Identity["schedulable"] };
declare const identityImpl: Identity["schedulable"];
// @ts-expect-error The outer signature must actually be callable.
makeSchedulable<NotCallable>(identityImpl);
