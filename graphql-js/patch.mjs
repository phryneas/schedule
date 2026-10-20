import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { git, orig, patched, patchFile, testPatchFile } from "./common.mjs";

const { values: args } = parseArgs({
  options: {
    force: { type: "boolean" },
    "with-additional-tests": { type: "boolean" },
  },
});
const base = git(["rev-parse", "HEAD"], orig).trim();
if (existsSync(patched)) {
  if (!args.force) {
    throw new Error("patched already exists. Save edits with update-patches.mjs, then use --force to recreate it.");
  }
  await rm(patched, { recursive: true, force: true });
}
git(["clone", "--local", "--no-hardlinks", "--", orig, patched]);
git(["config", "schedule.base", base], patched);
const withTests = args["with-additional-tests"] ?? false;
git(["config", "schedule.tests", String(withTests)], patched);
for (const file of withTests ? [patchFile, testPatchFile] : [patchFile]) {
  if ((await readFile(file, "utf8")).trim()) {
    git(["apply", "--check", file], patched);
    git(["apply", file], patched);
  }
}
const npm = (args, cwd = patched) => execFileSync("npm", args, {
  cwd, stdio: "inherit",
});
const manifest = JSON.parse(await readFile(join(patched, "package.json"), "utf8"));
const settings = [
  "name=@phryneas/scheduled-graphql",
  `dependencies.@phryneas/schedule=${process.env.SCHEDULE_PACKAGE ?? "https://pkg.pr.new/phryneas/schedule/@phryneas/schedule@2f05950"}`,
];
if (manifest.engines?.node) {
  settings.push(`engines.node=${manifest.engines.node.split("||").map(value => value.trim()).filter(value => !value.startsWith("^22.")).join(" || ")}`);
}
if (manifest.scripts?.check) {
  settings.push(`scripts.check=${manifest.scripts.check.replace(/ && npm run check:deno\b/g, "")}`);
}
if (manifest.scripts?.["testonly:cover"]) {
  settings.push(`scripts.testonly:cover=${manifest.scripts["testonly:cover"].replace(/--test-coverage-(lines|branches)=\d+/g, "--test-coverage-$1=97")}`);
}
if (manifest.scripts?.["check:spelling"]) {
  const spelling = manifest.scripts["check:spelling"];
  settings.push(`scripts.check:spelling=${spelling.includes("--gitignore-root") ? spelling : spelling.replace(/\bcspell\b/, "cspell --gitignore-root .")}`);
}
npm(["pkg", "set", ...settings]);

npm(["pkg", "set",
  "devDependencies.@babel/plugin-transform-export-namespace-from=^7.27.1",
  "devDependencies.@babel/plugin-transform-modules-commonjs=^7.27.1",
], join(patched, "integrationTests/dev-jest"));
const tsDirectory = join(patched, "integrationTests/ts");
const tsManifest = JSON.parse(await readFile(join(tsDirectory, "package.json"), "utf8"));
for (const version of ["4.9", "5.0", "5.1", "5.2"]) {
  delete tsManifest.dependencies[`typescript-${version}`];
}
npm(["pkg", "set", "--json", `dependencies=${JSON.stringify(tsManifest.dependencies)}`], tsDirectory);

npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
console.log(`Prepared ${patched}`);
