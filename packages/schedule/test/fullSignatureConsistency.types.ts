import { expectTypeOf } from "expect-type";
import { async, commands, makeSchedulable, sync } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";
import type { schedulableImplementationSymbol as key } from "../src/index.ts";

type Identity = {
  <T>(value: T): T;
  command: Identity[typeof key];
  [key]: {
    <T>(value: T): SchedulableIterable<T>;
    syncSignature?<T>(value: T): T;
    asyncSignature?<T>(value: T): Promise<Awaited<T>>;
  };
};
const identity = makeSchedulable<Identity>(function* <T>(value: T): SchedulableIterable<T> {
  return value;
});
expectTypeOf([1, 2, 3].map(identity)).toEqualTypeOf<number[]>();
expectTypeOf(identity(42)).toEqualTypeOf<number>();
expectTypeOf(sync(identity)(42)).toEqualTypeOf<number>();
expectTypeOf(async(identity)(42)).toEqualTypeOf<Promise<number>>();
expectTypeOf(commands.execute(identity)(42)).toEqualTypeOf<SchedulableIterable<number>>();
expectTypeOf(identity.command(42)).toEqualTypeOf<SchedulableIterable<number>>();
expectTypeOf(identity.command("value")).toEqualTypeOf<SchedulableIterable<string>>();

type WrongReturn = {
  (value: number): number;
  [key]: {
    (value: number): SchedulableIterable<number>;
    syncSignature?(value: number): string;
    asyncSignature?(value: number): Promise<number>;
  };
};
declare const wrongReturnImpl: WrongReturn[typeof key];
// @ts-expect-error The public and nested synchronous return types disagree.
makeSchedulable<WrongReturn>(wrongReturnImpl);

type WrongArgument = {
  (value: string): number;
  [key]: {
    (value: string): SchedulableIterable<number>;
    syncSignature?(value: number): number;
    asyncSignature?(value: string): Promise<number>;
  };
};
declare const wrongArgumentImpl: WrongArgument[typeof key];
// @ts-expect-error The public and nested synchronous parameters disagree.
makeSchedulable<WrongArgument>(wrongArgumentImpl);

type NotCallable = { [key]: Identity[typeof key] };
declare const identityImpl: Identity[typeof key];
// @ts-expect-error The outer signature must actually be callable.
makeSchedulable<NotCallable>(identityImpl);
