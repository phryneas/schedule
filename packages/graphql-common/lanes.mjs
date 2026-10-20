import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

// Keep identity and hooks independent of the operator's Git configuration.
const gitOptions = [
  "-c", "user.name=Schedule patch replay",
  "-c", "user.email=schedule-patches@example.invalid",
  "-c", "commit.gpgsign=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.editor=true",
  "-c", "rerere.enabled=true",
  "-c", "rerere.autoupdate=true",
];
function git(directory, args) {
  return execFileSync("git", [...gitOptions, ...args], {
    cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function laneDirectory(root, lane) {
  if (!/^\d+$/.test(lane)) throw new Error("A lane must be a major version, such as 17.");
  return resolve(root, "..", `graphql-${lane}`);
}

async function copyResolutions(source, destination) {
  if (!existsSync(source)) return;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]+$/.test(entry.name)) continue;
    const files = await readdir(join(source, entry.name));
    for (const file of files) {
      if (!/^preimage(?:\.\d+)?$/.test(file)) continue;
      const postimage = file.replace("preimage", "postimage");
      if (!files.includes(postimage)) continue;
      const target = join(destination, entry.name);
      await mkdir(target, { recursive: true });
      for (const name of [file, postimage]) {
        await cp(join(source, entry.name, name), join(target, name));
      }
    }
  }
}

function cachePath(directory) {
  return resolve(directory, git(directory, ["rev-parse", "--git-path", "rr-cache"]));
}

export function rebaseInProgress(directory) {
  return existsSync(resolve(directory, git(directory, ["rev-parse", "--git-path", "rebase-merge"])));
}

export function continueLane(directory, startArgs = ["rebase", "--continue"]) {
  let args = startArgs;
  while (true) {
    const result = spawnSync("git", [...gitOptions, ...args], {
      cwd: directory, encoding: "utf8",
    });
    if (result.error) throw result.error;
    if (result.status === 0) return;
    const conflicts = git(directory, ["diff", "--name-only", "--diff-filter=U"]);
    if (conflicts) {
      throw new Error(
        `Patch replay needs a resolution in ${directory}:\n${conflicts}\n` +
        "Resolve these files and git add them, then run patch.mjs --continue. " +
        "After validation, save learned resolutions with update-patches.mjs --resolutions.",
      );
    }
    // rerere.autoupdate stages only known resolutions. Rebase still stops after
    // applying one, so continue only when there is a staged resolution to commit.
    if (!rebaseInProgress(directory) || !git(directory, ["diff", "--cached", "--name-only"])) {
      throw new Error(result.stdout + result.stderr);
    }
    args = ["rebase", "--continue"];
  }
}

export async function prepareLane({ source, destination, lane, target = "HEAD" }) {
  const config = JSON.parse(await readFile(join(lane, "lane.json"), "utf8"));
  const targetCommit = git(source, ["rev-parse", `${target}^{commit}`]);
  const manifest = JSON.parse(git(source, ["show", `${targetCommit}:package.json`]));
  if (Number(manifest.version.split(".")[0]) !== config.major) {
    throw new Error(`Lane ${config.major} cannot patch GraphQL ${manifest.version}.`);
  }
  // Both the base and target history must be available; no implicit network fetch.
  git(source, ["merge-base", "--is-ancestor", config.base, targetCommit]);
  git(source, ["clone", "--local", "--no-hardlinks", "--", source, destination]);
  git(destination, ["checkout", "--detach", config.base]);
  git(destination, ["config", "schedule.base", targetCommit]);
  git(destination, ["config", "schedule.lane", String(config.major)]);
  git(destination, ["config", "rerere.enabled", "true"]);
  git(destination, ["config", "rerere.autoupdate", "true"]);
  for (const patch of config.patches) {
    if ((await readFile(resolve(lane, patch), "utf8")).trim()) {
      git(destination, ["apply", "--index", resolve(lane, patch)]);
    }
    git(destination, ["commit", "--allow-empty", "-m", `Schedule: ${patch}`]);
  }
  await copyResolutions(join(lane, "resolutions"), cachePath(destination));
  continueLane(destination, ["rebase", "--merge", "--empty=keep", "--onto", targetCommit, config.base]);
}

export async function saveResolutions(directory, lane) {
  if (rebaseInProgress(directory) || git(directory, ["diff", "--name-only", "--diff-filter=U"])) {
    throw new Error("Finish the rebase before exporting resolutions.");
  }
  await copyResolutions(cachePath(directory), join(lane, "resolutions"));
}
