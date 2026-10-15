import { expectTypeOf } from "expect-type";
import type { SchedulableIterable } from "../src/index.ts";
import { commands } from "../src/index.ts";
import type { Apply, MapResults, TypeFunction } from "../src/mapResults.ts";
import type {
  GraphQLType, GraphQLInputType, GraphQLOutputType,
  GraphQLNamedType, GraphQLNamedInputType, GraphQLNamedOutputType,
} from "graphql";

interface ToSchedulable extends TypeFunction {
  readonly output: SchedulableIterable<this["input"]>;
}
interface ToPromise extends TypeFunction {
  readonly output: Promise<this["input"]>;
}
interface ToArray extends TypeFunction {
  readonly output: Array<this["input"]>;
}
expectTypeOf<Apply<ToPromise, string>>().toEqualTypeOf<Promise<string>>();
expectTypeOf<Apply<ToSchedulable, void>>().toEqualTypeOf<SchedulableIterable<void>>();
expectTypeOf<Apply<ToArray, never>>().toEqualTypeOf<never[]>();

// GraphQL.js 17's five overloads, in their original order.
declare function getNamedType(type: undefined | null): void;
declare function getNamedType(type: GraphQLInputType): GraphQLNamedInputType;
declare function getNamedType(type: GraphQLOutputType): GraphQLNamedOutputType;
declare function getNamedType(type: GraphQLType): GraphQLNamedType;
declare function getNamedType(type: GraphQLType | null | undefined): GraphQLNamedType | undefined;
declare const input: GraphQLInputType;
declare const output: GraphQLOutputType;
declare const type: GraphQLType;
declare const maybe: GraphQLType | undefined;
declare const mapped: MapResults<typeof getNamedType, ToSchedulable>;
const executed = commands.execute(getNamedType);
expectTypeOf(executed(null)).toEqualTypeOf<SchedulableIterable<void>>();
expectTypeOf(executed(input)).toEqualTypeOf<SchedulableIterable<GraphQLNamedInputType>>();
expectTypeOf(executed(output)).toEqualTypeOf<SchedulableIterable<GraphQLNamedOutputType>>();
expectTypeOf(executed(type)).toEqualTypeOf<SchedulableIterable<GraphQLNamedType>>();
expectTypeOf(executed(maybe)).toEqualTypeOf<SchedulableIterable<GraphQLNamedType | undefined>>();
expectTypeOf(mapped(null)).toEqualTypeOf<SchedulableIterable<void>>();
expectTypeOf(mapped(input)).toEqualTypeOf<SchedulableIterable<GraphQLNamedInputType>>();
expectTypeOf(mapped(output)).toEqualTypeOf<SchedulableIterable<GraphQLNamedOutputType>>();
expectTypeOf(mapped(type)).toEqualTypeOf<SchedulableIterable<GraphQLNamedType>>();
expectTypeOf(mapped(maybe)).toEqualTypeOf<SchedulableIterable<GraphQLNamedType | undefined>>();
// @ts-expect-error The mapping must not admit unrelated arguments.
mapped(42);

declare function choose(value: number): number;
declare function choose(value: string): string;
expectTypeOf(commands.execute(choose)(1)).toEqualTypeOf<SchedulableIterable<number>>();
expectTypeOf(commands.execute(choose)("a")).toEqualTypeOf<SchedulableIterable<string>>();
declare const promised: MapResults<typeof choose, ToPromise>;
declare const arrayed: MapResults<typeof choose, ToArray>;
expectTypeOf(promised(1)).toEqualTypeOf<Promise<number>>();
expectTypeOf(promised("a")).toEqualTypeOf<Promise<string>>();
expectTypeOf(arrayed(1)).toEqualTypeOf<number[]>();
expectTypeOf(arrayed("a")).toEqualTypeOf<string[]>();

// One transformation handles overloads with different numbers of arguments.
declare function byArity(): boolean;
declare function byArity(value: string): string;
declare function byArity(left: number, right: number): number;
declare const scheduledByArity: MapResults<typeof byArity, ToSchedulable>;
expectTypeOf(scheduledByArity()).toEqualTypeOf<SchedulableIterable<boolean>>();
expectTypeOf(scheduledByArity("a")).toEqualTypeOf<SchedulableIterable<string>>();
expectTypeOf(scheduledByArity(1, 2)).toEqualTypeOf<SchedulableIterable<number>>();
// @ts-expect-error The two-argument overload still requires both arguments.
scheduledByArity(1);
// @ts-expect-error No three-argument overload exists.
scheduledByArity(1, 2, 3);

declare function four(value: "a"): 1;
declare function four(value: "b"): 2;
declare function four(value: "c"): 3;
declare function four(value: "d"): 4;
declare const mappedFour: MapResults<typeof four, ToPromise>;
expectTypeOf(mappedFour("a")).toEqualTypeOf<Promise<1>>();
expectTypeOf(mappedFour("b")).toEqualTypeOf<Promise<2>>();
expectTypeOf(mappedFour("c")).toEqualTypeOf<Promise<3>>();
expectTypeOf(mappedFour("d")).toEqualTypeOf<Promise<4>>();

declare function ten(value: 1): "one";
declare function ten(value: 2): "two";
declare function ten(value: 3): "three";
declare function ten(value: 4): "four";
declare function ten(value: 5): "five";
declare function ten(value: 6): "six";
declare function ten(value: 7): "seven";
declare function ten(value: 8): "eight";
declare function ten(value: 9): "nine";
declare function ten(value: 10): "ten";
declare const mappedTen: MapResults<typeof ten, ToPromise>;
const executedTen = commands.execute(ten);
expectTypeOf(executedTen(1)).toEqualTypeOf<SchedulableIterable<"one">>();
expectTypeOf(executedTen(2)).toEqualTypeOf<SchedulableIterable<"two">>();
expectTypeOf(executedTen(3)).toEqualTypeOf<SchedulableIterable<"three">>();
expectTypeOf(executedTen(4)).toEqualTypeOf<SchedulableIterable<"four">>();
expectTypeOf(executedTen(5)).toEqualTypeOf<SchedulableIterable<"five">>();
expectTypeOf(executedTen(6)).toEqualTypeOf<SchedulableIterable<"six">>();
expectTypeOf(executedTen(7)).toEqualTypeOf<SchedulableIterable<"seven">>();
expectTypeOf(executedTen(8)).toEqualTypeOf<SchedulableIterable<"eight">>();
expectTypeOf(executedTen(9)).toEqualTypeOf<SchedulableIterable<"nine">>();
expectTypeOf(executedTen(10)).toEqualTypeOf<SchedulableIterable<"ten">>();
// @ts-expect-error execute retains argument checking for the mapped overloads.
executedTen(11);
expectTypeOf(mappedTen(1)).toEqualTypeOf<Promise<"one">>();
expectTypeOf(mappedTen(2)).toEqualTypeOf<Promise<"two">>();
expectTypeOf(mappedTen(3)).toEqualTypeOf<Promise<"three">>();
expectTypeOf(mappedTen(4)).toEqualTypeOf<Promise<"four">>();
expectTypeOf(mappedTen(5)).toEqualTypeOf<Promise<"five">>();
expectTypeOf(mappedTen(6)).toEqualTypeOf<Promise<"six">>();
expectTypeOf(mappedTen(7)).toEqualTypeOf<Promise<"seven">>();
expectTypeOf(mappedTen(8)).toEqualTypeOf<Promise<"eight">>();
expectTypeOf(mappedTen(9)).toEqualTypeOf<Promise<"nine">>();
expectTypeOf(mappedTen(10)).toEqualTypeOf<Promise<"ten">>();
// @ts-expect-error No overload accepts 11.
mappedTen(11);

type Receiver = { total: number };
declare function add(this: Receiver, amount: number, label?: string, ...extra: number[]): number;
declare const mappedAdd: MapResults<typeof add, ToSchedulable>;
expectTypeOf(mappedAdd.bind({ total: 1 })(2, undefined, 3)).toEqualTypeOf<SchedulableIterable<number>>();
// @ts-expect-error Receiver types remain checked.
mappedAdd.bind({ total: "wrong" });
// @ts-expect-error Argument types remain checked.
mappedAdd.bind({ total: 1 })("wrong");

// Document the remaining generic limitation: extraction loses the relationship.
declare function identity<T>(value: T): T;
declare const mappedIdentity: MapResults<typeof identity, ToSchedulable>;
expectTypeOf(mappedIdentity(1)).toEqualTypeOf<SchedulableIterable<unknown>>();
expectTypeOf(commands.execute(identity)(1)).toEqualTypeOf<SchedulableIterable<number>>();

// Generic overloads still lose their argument/result relationship.
declare function genericOverload<T>(value: T): T;
declare function genericOverload<T>(value: T, array: true): T[];
expectTypeOf(commands.execute(genericOverload)(1)).toEqualTypeOf<SchedulableIterable<unknown>>();
expectTypeOf(commands.execute(genericOverload)(1, true)).toEqualTypeOf<SchedulableIterable<unknown[]>>();
