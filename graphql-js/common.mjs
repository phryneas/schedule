import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const root = fileURLToPath(new URL("./", import.meta.url));
const workDirectory = resolve(process.env.GRAPHQL_WORK_DIR ?? root);
export const orig = resolve(workDirectory, "orig");
export const patched = resolve(workDirectory, "patched");
export const transformed = resolve(workDirectory, "transformed");
export const optionalTestFiles = [
  "src/language/__tests__/parser-test.ts",
  "src/language/__tests__/visitor-test.ts",
];

export function git(args, cwd = root) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 100 * 1024 * 1024,
  });
}
