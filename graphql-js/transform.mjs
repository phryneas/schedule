import { execFileSync } from "node:child_process";
import { cp, readFile, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformProject } from "../packages/schedule-codemod/src/project.ts";
import { patched, transformed } from "./common.mjs";

if (process.argv.length !== 2) throw new Error("Usage: node graphql-js/transform.mjs");
const options = JSON.parse(await readFile(new URL("./codemod.json", import.meta.url), "utf8"));
// Validate the input before removing previous output.
await readFile(resolve(patched, "tsconfig.json"), "utf8");
const prettier = fileURLToPath(import.meta.resolve("prettier/bin/prettier.cjs"));
await readFile(prettier, "utf8");
await rm(transformed, { recursive: true, force: true });
await cp(patched, transformed, {
  recursive: true,
  filter(source) {
    const path = relative(patched, source);
    return ![".git", "node_modules", "src"].includes(path.split(/[\\/]/)[0]);
  },
});
await transformProject({
  ...options,
  tsconfig: resolve(patched, "tsconfig.json"),
  sourceDirectory: resolve(patched, "src"),
  outputDirectory: resolve(transformed, "src"),
});
execFileSync(process.execPath, [prettier, "--write", "src"], {
  cwd: transformed,
  stdio: "inherit",
});
console.log(`Transformed and formatted GraphQL.js into ${transformed}`);
