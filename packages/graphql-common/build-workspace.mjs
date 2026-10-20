import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { positionals: [stage, major, ...extra] } = parseArgs({ allowPositionals: true });
if (extra.length || !["prepare", "build"].includes(stage) || !["16", "17"].includes(major)) {
  throw new Error("Usage: node packages/graphql-common/build-workspace.mjs <prepare|build> <16|17>");
}

const repository = fileURLToPath(new URL("../../", import.meta.url));
const workspace = join(repository, "packages", `graphql-${major}`);
const workDirectory = join(workspace, ".tmp");
const patched = join(workDirectory, "patched");
const transformed = join(workDirectory, "transformed");
const dist = join(workspace, "dist");
const env = {
  ...process.env,
  GRAPHQL_WORK_DIR: workDirectory,
  SCHEDULE_PACKAGE: `file:${join(repository, "packages/schedule")}`,
};
const npm = (args, cwd) => execFileSync("npm", ["--prefix", cwd, ...args], {
  cwd, env, stdio: "inherit",
});
const run = (script, ...args) => execFileSync(process.execPath, [
  fileURLToPath(new URL(script, import.meta.url)), ...args,
], { cwd: repository, env, stdio: "inherit" });

if (stage === "prepare") {
  const versions = [JSON.parse(execFileSync("npm", ["view", `graphql@${major}`, "version", "--json"], {
    encoding: "utf8", env,
  }))].flat().filter(version => new RegExp(`^${major}\\.\\d+\\.\\d+$`).test(version))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const version = versions.at(-1);
  if (!version) throw new Error(`No stable GraphQL ${major} release found`);
  console.log(`Preparing GraphQL ${version}`);
  await rm(workDirectory, { recursive: true, force: true });
  await rm(dist, { recursive: true, force: true });
  await mkdir(workDirectory, { recursive: true });
  run("clone.mjs", `v${version}`);
  run("patch.mjs");
  npm(["ci"], patched);
  run("transform.mjs");
  await rename(join(patched, "node_modules"), join(transformed, "node_modules"));
} else {
  npm(["run", "check"], transformed);
  npm(["run", "testonly"], transformed);
  npm(["run", "build:npm"], transformed);
  await rm(dist, { recursive: true, force: true });
  await rename(join(transformed, "npmDist"), dist);
  const { name } = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));
  npm(["pkg", "set", `name=${name}`], dist);
  const { version } = JSON.parse(await readFile(join(dist, "package.json"), "utf8"));
  const summary = `Built ${name} from GraphQL ${version}\n`;
  console.log(summary.trim());
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
