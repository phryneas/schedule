import { writeFile } from "node:fs/promises";
import { git, patched, patchFile } from "./common.mjs";

if (process.argv.length !== 2) throw new Error("Usage: node graphql-js/update-patches.mjs");

const base = git(["config", "--get", "schedule.base"], patched).trim();
// Stage new files and deletions too; upstream's .gitignore excludes dependencies.
git(["add", "--all"], patched);
const patch = git(["diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-color", base, "--"], patched);
await writeFile(patchFile, patch);
console.log(`Updated ${patchFile}`);
