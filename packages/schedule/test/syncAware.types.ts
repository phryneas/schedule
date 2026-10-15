import { expectTypeOf } from "expect-type";
import { syncAware } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

const command = syncAware({
  sync(this: { prefix: string }, value: number, suffix?: string) {
    return this.prefix + value + (suffix ?? "");
  },
  async async(this: { prefix: string }, value: number, suffix?: string) {
    return this.prefix + value + (suffix ?? "");
  },
});
expectTypeOf(command.call({ prefix: "x" }, 1)).toEqualTypeOf<SchedulableIterable<string>>();
expectTypeOf(command.bind({ prefix: "x" })(1, "!")).toEqualTypeOf<SchedulableIterable<string>>();
// @ts-expect-error The argument must be a number.
command.call({ prefix: "x" }, "wrong");
// @ts-expect-error The receiver must provide prefix.
command.call({}, 1);
