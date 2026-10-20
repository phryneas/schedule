import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { continueLane, prepareLane, saveResolutions } from "../packages/graphql-common/lanes.mjs";

test("patch lanes replay committed resolutions in fresh checkouts and stop on new conflicts", async t => {
  const root = await mkdtemp(join(tmpdir(), "schedule-lanes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "upstream");
  const lane = join(root, "17");
  await mkdir(source);
  await mkdir(lane);
  function git(args: string[], cwd = source) {
    return execFileSync("git", [
      "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
      "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null",
      ...args,
    ], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  function commit(message: string) {
    git(["add", "."]);
    git(["commit", "-m", message]);
    return git(["rev-parse", "HEAD"]);
  }
  git(["init"]);
  await writeFile(join(source, "package.json"), '{"version":"17.0.0"}\n');
  await writeFile(join(source, "example.txt"), "before\noriginal\nafter\n");
  const base = commit("base");
  await writeFile(join(source, "example.txt"), "before\nscheduled\nafter\n");
  await writeFile(join(lane, "changes.patch"), git(["diff", "--full-index"]) + "\n");
  await writeFile(join(lane, "lane.json"), JSON.stringify({ major: 17, base, patches: ["changes.patch"] }));
  git(["restore", "."]);
  await writeFile(join(source, "example.txt"), "before\nupstream\nafter\n");
  const target = commit("upstream update");
  const first = join(root, "first");
  await assert.rejects(prepareLane({ source, destination: first, lane, target }), /needs a resolution/);
  await assert.rejects(saveResolutions(first, lane), /Finish the rebase/);
  await writeFile(join(first, "example.txt"), "before\nscheduled upstream\nafter\n");
  git(["add", "example.txt"], first);
  continueLane(first);
  await saveResolutions(first, lane);
  const entries = await readdir(join(lane, "resolutions"));
  assert.equal(entries.length, 1);
  assert.deepEqual((await readdir(join(lane, "resolutions", entries[0]))).sort(), ["postimage", "preimage"]);

  // There is no shared .git directory/cache: replay must use the tracked pairs.
  const second = join(root, "second");
  await prepareLane({ source, destination: second, lane, target });
  assert.equal(await readFile(join(second, "example.txt"), "utf8"), "before\nscheduled upstream\nafter\n");
  assert.equal(git(["status", "--porcelain"], second), "");
  assert.equal(git(["rev-parse", "HEAD^"], second), target);

  await writeFile(join(source, "example.txt"), "before\nanother rewrite\nafter\n");
  const changed = commit("different conflict");
  await assert.rejects(prepareLane({ source, destination: join(root, "third"), lane, target: changed }), /needs a resolution/);
  await writeFile(join(source, "package.json"), '{"version":"16.14.2"}\n');
  const otherMajor = commit("different major");
  await assert.rejects(prepareLane({ source, destination: join(root, "wrong-lane"), lane, target: otherMajor }), /cannot patch GraphQL 16/);
});
