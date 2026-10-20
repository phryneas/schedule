import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { git, root, orig, patched } from "./common.mjs";
import { continueLane, laneDirectory, prepareLane, rebaseInProgress } from "./lanes.mjs";

const { values: args } = parseArgs({
  options: {
    force: { type: "boolean" },
    continue: { type: "boolean" },
  },
});
if (args.continue && args.force) {
  throw new Error("--continue cannot be combined with other options.");
}
if (args.continue) {
  if (!rebaseInProgress(patched)) throw new Error("No lane rebase is in progress.");
  continueLane(patched);
} else {
  const upstream = JSON.parse(git(["show", "HEAD:package.json"], orig));
  const major = upstream.version.split(".")[0];
  const lane = laneDirectory(root, major);
  if (!existsSync(join(lane, "lane.json"))) {
    throw new Error(`No patch lane for GraphQL ${upstream.version}. Add lanes/${major}/lane.json before patching this major version.`);
  }
  if (existsSync(patched)) {
    if (!args.force) {
      throw new Error("patched already exists. Save edits with update-patches.mjs, then use --force to recreate it.");
    }
    await rm(patched, { recursive: true, force: true });
  }
  await prepareLane({ source: orig, destination: patched, lane });
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
