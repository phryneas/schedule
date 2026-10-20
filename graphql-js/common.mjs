import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("./", import.meta.url));
export const orig = fileURLToPath(new URL("./orig", import.meta.url));
export const patched = fileURLToPath(new URL("./patched", import.meta.url));
export const transformed = fileURLToPath(new URL("./transformed", import.meta.url));
export const patchFile = fileURLToPath(new URL("./changes.patch", import.meta.url));
export const testPatchFile = fileURLToPath(new URL("./tests.patch", import.meta.url));
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
