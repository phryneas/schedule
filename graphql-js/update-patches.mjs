import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { git, root, patched, optionalTestFiles } from "./common.mjs";
import { laneDirectory, saveResolutions } from "./lanes.mjs";

const { values: args } = parseArgs({ options: { resolutions: { type: "boolean" } } });
const lane = git(["config", "--default=", "--get", "schedule.lane"], patched).trim();
if (!lane) throw new Error("This checkout predates patch lanes. Preserve any edits before recreating it with patch.mjs --force.");
if (args.resolutions) {
  await saveResolutions(patched, laneDirectory(root, lane));
  console.log(`Updated lane ${lane} resolutions.`);
  process.exit(0);
}

const base = git(["config", "--get", "schedule.base"], patched).trim();
const directory = laneDirectory(root, lane);
const config = JSON.parse(await readFile(join(directory, "lane.json"), "utf8"));
if (base !== config.base || config.patches.length !== 1) {
  throw new Error("To update a lane's starting patch, prepare its base release first. Use --resolutions to export conflict resolutions from later releases.");
}
const outputPatch = join(directory, config.patches[0]);
// Stage new files and deletions too; upstream's .gitignore excludes dependencies.
git(["add", "--all"], patched);
const diffArgs = ["diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-color", base, "--"];
const tests = git([...diffArgs, ...optionalTestFiles], patched);
if (tests.trim()) {
  throw new Error("Optional regression test files were edited. Preserve those changes separately; they are not included in lane patches.");
}
const patch = git([...diffArgs, ".", ...optionalTestFiles.map(file => `:(exclude)${file}`),
  ":(exclude,glob)**/package.json", ":(exclude,glob)**/package-lock.json",
], patched);
await writeFile(outputPatch, patch);
console.log(`Updated ${outputPatch}`);
