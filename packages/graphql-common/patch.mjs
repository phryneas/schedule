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
    throw new Error(`No patch lane for GraphQL ${upstream.version}. Add packages/graphql-${major}/lane.json before patching this major version.`);
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
const major = Number(manifest.version.split(".")[0]);
const settings = [
  "name=@phryneas/scheduled-graphql",
  `dependencies.@phryneas/schedule=${process.env.SCHEDULE_PACKAGE ?? "https://pkg.pr.new/phryneas/schedule/@phryneas/schedule@2f05950"}`,
];
if (major === 16) {
  settings.push(
    "engines.node=^24.0.0 || ^25.0.0 || >=26.0.0",
    "devDependencies.typescript=^6.0.3",
    "devDependencies.@types/node=^24.0.0",
    "devDependencies.prettier-typescript=npm:prettier@3.8.1",
    "scripts.prettier=node node_modules/prettier/bin-prettier.js --write --list-different . '!src/**' && node node_modules/prettier-typescript/bin/prettier.cjs --write --list-different src",
    "scripts.prettier:check=node node_modules/prettier/bin-prettier.js --check . '!src/**' && node node_modules/prettier-typescript/bin/prettier.cjs --check src",
    ...["@babel/core", "@babel/plugin-syntax-typescript", "@babel/plugin-transform-typescript",
      "@babel/preset-env", "@babel/register"].map(name => `devDependencies.${name}=^7.28.0`),
    "scripts.check:integrations=npm run build:npm && mocha --full-trace integrationTests/*-test.js",
  );
} else if (manifest.engines?.node) {
  settings.push(`engines.node=${manifest.engines.node.split("||").map(value => value.trim()).filter(value => !value.startsWith("^22.")).join(" || ")}`);
}
if (manifest.scripts?.check) {
  settings.push(`scripts.check=${manifest.scripts.check.replace(/ && npm run check:deno\b/g, "")}`);
}
if (manifest.scripts?.["testonly:cover"]) {
  settings.push(`scripts.testonly:cover=${manifest.scripts["testonly:cover"]
    .replace(/--test-coverage-lines=\d+/g, "--test-coverage-lines=97")
    .replace(/--test-coverage-branches=\d+/g, "--test-coverage-branches=96")}`);
}
if (manifest.scripts?.["check:spelling"]) {
  const spelling = manifest.scripts["check:spelling"];
  settings.push(`scripts.check:spelling=${spelling.includes("--gitignore-root") ? spelling : spelling.replace(/\bcspell\b/, "cspell --gitignore-root .")}`);
}
npm(["pkg", "set", ...settings]);
if (major === 16) {
  npm(["pkg", "set", "--json", 'typesVersions={">=6.0.0":{"*":["*"]}}']);
}

if (existsSync(join(patched, "integrationTests/dev-jest/package.json"))) {
  npm(["pkg", "set",
    "devDependencies.@babel/plugin-transform-export-namespace-from=^7.27.1",
    "devDependencies.@babel/plugin-transform-modules-commonjs=^7.27.1",
  ], join(patched, "integrationTests/dev-jest"));
}
const tsDirectory = join(patched, "integrationTests/ts");
const tsManifest = JSON.parse(await readFile(join(tsDirectory, "package.json"), "utf8"));
for (const name of Object.keys(tsManifest.dependencies)) {
  if (/^typescript-(?:4\.\d+|5\.[012])$/.test(name)) {
    delete tsManifest.dependencies[name];
  }
}
if (major === 16) {
  for (const name of Object.keys(tsManifest.dependencies)) {
    if (name.startsWith("typescript-")) delete tsManifest.dependencies[name];
  }
  tsManifest.dependencies["typescript-6.0"] = "npm:typescript@6.0.x";
}
npm(["pkg", "set", "--json", `dependencies=${JSON.stringify(tsManifest.dependencies)}`], tsDirectory);

npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
console.log(`Prepared ${patched}`);
