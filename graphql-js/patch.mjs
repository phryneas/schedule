import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { git, orig, patched, patchFile } from "./common.mjs";

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--force")) {
  throw new Error("Usage: node graphql-js/patch.mjs [--force]");
}
const base = git(["rev-parse", "HEAD"], orig).trim();
if (existsSync(patched)) {
  if (!args.includes("--force")) {
    throw new Error("patched already exists. Save edits with update-patches.mjs, then use --force to recreate it.");
  }
  await rm(patched, { recursive: true, force: true });
}
git(["clone", "--local", "--no-hardlinks", "--", orig, patched]);
git(["config", "schedule.base", base], patched);
if ((await readFile(patchFile, "utf8")).trim()) {
  git(["apply", "--check", patchFile], patched);
  git(["apply", patchFile], patched);
}
console.log(`Prepared ${patched}`);
