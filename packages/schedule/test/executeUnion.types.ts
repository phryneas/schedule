// Reduced from GraphQLScalarType | GraphQLEnumType's coerceInputValue.
import { expectTypeOf } from "expect-type";
import { commands } from "../src/index.ts";
import type { SchedulableIterable, schedulableImplementationSignal } from "../src/index.ts";
import type { HasMultipleSignatures, HasOverloads, IsUnion } from "../src/mapResults.ts";

type ScalarCoercer = (inputValue: unknown) => unknown;
type EnumCoercer = {
  (inputValue: unknown, hideSuggestions?: boolean | null): unknown;
  [schedulableImplementationSignal]: {
    (inputValue: unknown, hideSuggestions?: boolean | null): SchedulableIterable<unknown>;
    syncSignature?: (inputValue: unknown, hideSuggestions?: boolean | null) => unknown;
    asyncSignature?: (inputValue: unknown, hideSuggestions?: boolean | null) => Promise<unknown>;
  };
};
declare const type: { coerceInputValue: ScalarCoercer } | { coerceInputValue: EnumCoercer };

// Each union member has one signature, so the overload detector returns false.
expectTypeOf<HasOverloads<typeof type.coerceInputValue>>().toEqualTypeOf<false>();
expectTypeOf<IsUnion<typeof type.coerceInputValue>>().toEqualTypeOf<boolean>();
expectTypeOf<HasMultipleSignatures<typeof type.coerceInputValue>>().toEqualTypeOf<true>();
type.coerceInputValue("value", true); // Accepted by TypeScript.

expectTypeOf(commands.execute(type.coerceInputValue).bind(type)("value", true))
  .toEqualTypeOf<SchedulableIterable<unknown>>();
// @ts-expect-error The optional argument remains checked.
commands.execute(type.coerceInputValue).bind(type)("value", "wrong");

type Receiver = { prefix: string };
declare const ordinaryUnion:
  | ((this: Receiver, value: string) => string)
  | ((this: Receiver, value: string, uppercase?: boolean) => number);
const mappedOrdinary = commands.execute(ordinaryUnion).bind({ prefix: ">" });
expectTypeOf(mappedOrdinary("value", true))
  .toEqualTypeOf<SchedulableIterable<string> | SchedulableIterable<number>>();
// @ts-expect-error Union members still require a string argument.
mappedOrdinary(123);
// @ts-expect-error The shared receiver remains checked.
commands.execute(ordinaryUnion).bind({ prefix: 123 });

declare const incompatibleUnion: ((value: string) => string) | ((value: number) => number);
// @ts-expect-error A string cannot be passed to every possible union member.
commands.execute(incompatibleUnion)("value");

declare const notAlwaysCallable: ((value: string) => string) | number;
// @ts-expect-error Detecting a union must not admit non-function members.
commands.execute(notAlwaysCallable);

type GenericScheduled = {
  <T>(value: T): T;
  [schedulableImplementationSignal]: {
    <T>(value: T): SchedulableIterable<T>;
  };
};
declare const mixedGeneric: GenericScheduled | ((value: string) => number);
expectTypeOf(commands.execute(mixedGeneric)("value"))
  .toEqualTypeOf<SchedulableIterable<"value"> | SchedulableIterable<number>>();
