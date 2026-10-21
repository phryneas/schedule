import { expectTypeOf } from "expect-type";
import { commands, makeSchedulable } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";
import type { schedulableImplementationSignal as key } from "../src/index.ts";

function identity<T>(value: T): T { return value; }
expectTypeOf(commands.execute(identity)(42)).toEqualTypeOf<SchedulableIterable<number>>();

const receiver = { total: 10 };
function add(this: typeof receiver, amount: number): number { return this.total + amount; }
expectTypeOf(commands.execute(add).bind(receiver)(3)).toEqualTypeOf<SchedulableIterable<number>>();
// @ts-expect-error Arguments are checked after binding the receiver.
commands.execute(add).bind(receiver)("three");
// @ts-expect-error The receiver type is checked.
commands.execute(add).bind({ total: "ten" })(3);

const optional: { method?: (value: number) => string } = {};
if (optional.method) {
  expectTypeOf(commands.execute(optional.method).bind(optional)(42)).toEqualTypeOf<SchedulableIterable<string>>();
}

const generic = makeSchedulable<{
  <T>(value: T): T;
  [key]: {
    <T>(value: T): SchedulableIterable<T>;
    syncSignature?<T>(value: T): T;
    asyncSignature?<T>(value: T): Promise<Awaited<T>>;
  };
}>(function* <T>(value: T): SchedulableIterable<T> { return value; });
expectTypeOf(commands.execute(generic)(42)).toEqualTypeOf<SchedulableIterable<number>>();
expectTypeOf(commands.execute(generic).bind(receiver)(42)).toEqualTypeOf<SchedulableIterable<number>>();

declare const broad: Function;
expectTypeOf(commands.execute(broad)(1, "text")).toEqualTypeOf<SchedulableIterable<any>>();
expectTypeOf(commands.execute(broad, true).bind(receiver)()).toEqualTypeOf<SchedulableIterable<any>>();
declare const dynamic: Record<string, unknown>;
if (typeof dynamic.toJSON === "function") {
  expectTypeOf(commands.execute(dynamic.toJSON).bind(dynamic)()).toEqualTypeOf<SchedulableIterable<any>>();
}
// @ts-expect-error The fallback must not allow non-functions.
commands.execute({});
