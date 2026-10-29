import { expectTypeOf } from "expect-type";
import { async, emit, execute, isSchedulableFunction, makeSchedulable, sync, yieldNow } from "../src/index.ts";
import type { SchedulableIterable, SchedulableMethod } from "../src/index.ts";

expectTypeOf(emit(1)).toEqualTypeOf<SchedulableIterable<void, number>>();
const work = makeSchedulable(function* () {
  yield* emit(1);
  yield* yieldNow;
  return "finished";
});
expectTypeOf(work.schedulable()).toEqualTypeOf<SchedulableIterable<string, number>>();
expectTypeOf(execute(work)()).toEqualTypeOf<SchedulableIterable<string, number>>();
expectTypeOf(sync(work.schedulable(), {
  onValue(value) { expectTypeOf(value).toEqualTypeOf<number>(); },
})).toEqualTypeOf<string>();
expectTypeOf(async(work.schedulable(), {
  onValue(value) { expectTypeOf(value).toEqualTypeOf<number>(); },
})).toEqualTypeOf<Promise<string>>();

const parent = makeSchedulable(function* () {
  return yield* execute(work)();
});
expectTypeOf(parent.schedulable()).toEqualTypeOf<SchedulableIterable<string, number>>();
function* mixed(): SchedulableIterable<boolean, string | number> {
  yield* work.schedulable();
  yield* emit("partial");
  return true;
}
async(mixed(), { onValue(value) { expectTypeOf(value).toEqualTypeOf<string | number>(); } });
const mixedWork = makeSchedulable(function* () {
  yield* emit(1);
  yield* emit("partial");
});
expectTypeOf(mixedWork.schedulable()).toEqualTypeOf<SchedulableIterable<void, string | number>>();

const silent = makeSchedulable(function* () { yield* yieldNow; return 1; });
expectTypeOf(silent.schedulable()).toEqualTypeOf<SchedulableIterable<number>>();
sync(silent.schedulable(), { onValue(value) { expectTypeOf(value).toEqualTypeOf<never>(); } });

declare const method: SchedulableMethod<(this: { base: number }, value: number) => string, number>;
expectTypeOf(method.schedulable.call({ base: 1 }, 2)).toEqualTypeOf<SchedulableIterable<string, number>>();

type Identity = {
  <T>(value: T): T;
  schedulable<T>(value: T): SchedulableIterable<T, T>;
};
const identity = makeSchedulable<Identity>(function* <T>(value: T): SchedulableIterable<T, T> {
  yield* emit(value);
  return value;
});
expectTypeOf(execute(identity)(42)).toEqualTypeOf<SchedulableIterable<number, number>>();

// @ts-expect-error The callback must accept the emitted number.
sync(work.schedulable(), { onValue(value: string) {} });
// @ts-expect-error The callback must accept the emitted number.
async(work.schedulable(), { onValue(value: string) {} });
// @ts-expect-error Omitting the emission type means no values may be emitted.
const silentIterable: SchedulableIterable<void> = emit(1);

declare const candidate: unknown;
if (isSchedulableFunction(candidate)) {
  sync(candidate.schedulable(), { onValue(value) { expectTypeOf(value).toEqualTypeOf<unknown>(); } });
  async(candidate.schedulable(), { onValue(value) { expectTypeOf(value).toEqualTypeOf<unknown>(); } });
  // @ts-expect-error An unknown function may emit values other than strings.
  sync(candidate.schedulable(), { onValue(value: string) { value.toUpperCase(); } });
  // @ts-expect-error An unknown function may emit values other than strings.
  async(candidate.schedulable(), { onValue(value: string) { value.toUpperCase(); } });
}
if (isSchedulableFunction<number, []>(candidate)) {
  expectTypeOf(candidate.schedulable()).toEqualTypeOf<SchedulableIterable<number, unknown>>();
}
if (isSchedulableFunction<number, [], number>(candidate)) {
  expectTypeOf(candidate.schedulable()).toEqualTypeOf<SchedulableIterable<number, number>>();
}
