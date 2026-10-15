// Maps up to ten non-generic overloads. Generic relationships are lost.
export interface TypeFunction {
  readonly input: unknown;
  readonly output: unknown;
}

export type Apply<F extends TypeFunction, Input> = (F & {
  readonly input: Input;
})["output"];

export type IsUnion<T, Whole = T> = T extends Whole
  ? [Whole] extends [T]
    ? false
    : true
  : never;

// Fewer overloads are padded by repeating the first signature.
export type MapResults<F, M extends TypeFunction> = F extends any
  ? HasOverloads<F> extends false
    ? // special case for unions in which members only have one overload
      F extends {
        (this: infer T1, ...args: infer A1): infer R1;
      }
      ? {
          (this: T1, ...args: A1): Apply<M, R1>;
        }
      : never
    : F extends {
          (this: infer T1, ...args: infer A1): infer R1;
          (this: infer T2, ...args: infer A2): infer R2;
          (this: infer T3, ...args: infer A3): infer R3;
          (this: infer T4, ...args: infer A4): infer R4;
          (this: infer T5, ...args: infer A5): infer R5;
          (this: infer T6, ...args: infer A6): infer R6;
          (this: infer T7, ...args: infer A7): infer R7;
          (this: infer T8, ...args: infer A8): infer R8;
          (this: infer T9, ...args: infer A9): infer R9;
          (this: infer T10, ...args: infer A10): infer R10;
        }
      ? {
          (this: T1, ...args: A1): Apply<M, R1>;
          (this: T2, ...args: A2): Apply<M, R2>;
          (this: T3, ...args: A3): Apply<M, R3>;
          (this: T4, ...args: A4): Apply<M, R4>;
          (this: T5, ...args: A5): Apply<M, R5>;
          (this: T6, ...args: A6): Apply<M, R6>;
          (this: T7, ...args: A7): Apply<M, R7>;
          (this: T8, ...args: A8): Apply<M, R8>;
          (this: T9, ...args: A9): Apply<M, R9>;
          (this: T10, ...args: A10): Apply<M, R10>;
        }
      : never
  : never;

type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

// Keep single-signature functions on execute's higher-order inference path.
// This detects differing final two signatures, not genericity or an exact count.
export type HasOverloads<F> = F extends {
  (this: infer T1, ...args: infer A1): infer R1;
  (this: infer T2, ...args: infer A2): infer R2;
}
  ? Same<[T1, A1, R1], [T2, A2, R2]> extends true
    ? false
    : true
  : false;

export type HasMultipleSignatures<F> =
  true extends HasOverloads<F> | IsUnion<F> ? true : false;
