import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { git, patched, patchFile, testPatchFile, optionalTestFiles } from "./common.mjs";

parseArgs();

const base = git(["config", "--get", "schedule.base"], patched).trim();
// Stage new files and deletions too; upstream's .gitignore excludes dependencies.
git(["add", "--all"], patched);
const diffArgs = ["diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-color", base, "--"];
const tests = git([...diffArgs, ...optionalTestFiles], patched);
const withTests = git(["config", "--type=bool", "--default=false", "--get", "schedule.tests"], patched).trim() === "true";
if (!withTests && tests.trim()) {
  throw new Error("Optional test files were edited without --with-additional-tests. Save those edits before recreating patched with patch.mjs --force --with-additional-tests.");
}
const patch = git([...diffArgs, ".", ...optionalTestFiles.map(file => `:(exclude)${file}`),
  ":(exclude,glob)**/package.json", ":(exclude,glob)**/package-lock.json",
], patched);
await writeFile(patchFile, patch);
if (withTests) {
  await writeFile(testPatchFile, tests);
  console.log(`Updated ${testPatchFile}`);
}
console.log(`Updated ${patchFile}`);
