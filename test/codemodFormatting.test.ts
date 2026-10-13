import assert from "node:assert/strict";
import test from "node:test";
import { transformSource } from "../src/codemod/index.ts";
import { parseSync } from "@babel/core";

test("files with no transformed functions retain their exact formatting", () => {
  const source = `// A deliberately spaced declaration.
export const settings = {
  first: 'one',

  second: "two",
};


export type Options = {
  first: string;

  second: number;
};
`;
  for (const input of [source, source.trimEnd(), source.replaceAll("\n", "\r\n")]) {
    assert.equal(transformSource(input, "fixture.ts"), input);
  }
});

test("transformation preserves formatting in untouched declarations and function bodies", () => {
  const untouched = `import { value } from './dependency.ts';


// Keep these blank lines and quotes.
export const settings = {
  first: 'one',

  second: "two",
};`;
  const body = `  const result = value + amount;


  // Keep the return separated.
  return result;`;
  const unchangedFunction = `export async function external() {
  const answer = 42;

  return answer;
}`;
  const output = transformSource(`${untouched}

export function add(amount: number): number {
  value.toString();
${body}
}

${unchangedFunction}
`, "fixture.ts");
  assert.ok(output.includes(untouched));
  assert.ok(output.includes(body));
  assert.ok(output.includes(unchangedFunction));
  assert.match(output, /_makeSchedulable/);
});

test("printing preserves template whitespace and yield precedence in type assertions", () => {
  const source = 'export function text(fn: () => string) {\n  const literal = `\n    text\n\n`;\n  return fn() as string;\n}\n';
  const output = transformSource(source, "fixture.ts");
  assert.ok(output.includes('`\n    text\n\n`'));
  assert.match(output, /\(yield\* .*\) as string/);
  assert.ok(parseSync(output, { configFile: false, babelrc: false, parserOpts: { plugins: ["typescript"] } }));
});

test("function and method documentation survives replacement and hoisting", () => {
  const comments = [
    "/** Exported docs.\n * @param value - The input.\n * @example work(1);\n */",
    "/** Local docs. */",
    "/** Default docs. */",
    "/** Overload docs. */",
    "/** Method docs. */",
  ];
  const source = `
    ${comments[0]}
    export function work(value: number): number { return helper(value); }
    ${comments[1]}
    function helper(value: number): number { return Number(value); }
    ${comments[2]}
    export default function run(): number { return work(1); }
    ${comments[3]}
    export function overloaded(value: number): number;
    export function overloaded(value: number): number { return work(value); }
    export class Worker {
      ${comments[4]}
      method(value: number): number { return work(value); }
    }
  `;
  const output = transformSource(source, "fixture.ts");
  const parsed = parseSync(output, { configFile: false, babelrc: false, parserOpts: { plugins: ["typescript"] } })!;
  const expected = parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ["typescript"] } })!;
  assert.deepEqual(parsed.comments!.map(c => c.value.trim()).sort(), expected.comments!.map(c => c.value.trim()).sort());
  assert.ok(output.indexOf("Exported docs.") < output.indexOf("var work ="));
  assert.ok(output.indexOf("Method docs.") < output.indexOf("declare method:"));
});

test("comments inside cloned return types are preserved", () => {
  const output = transformSource(`
    export class Worker {
      values(): Array<number /* item type */> { return getValues(); }
    }
  `, "fixture.ts");
  assert.ok(output.includes("/* item type */"));
});
