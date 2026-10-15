import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

test("GraphQL workflow round-trips patches and regenerates transformed sources", async t => {
  const repository = resolve(".");
  await mkdir(join(repository, ".tmp"), { recursive: true });
  const directory = await mkdtemp(join(repository, ".tmp/graphql-workflow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workflow = join(directory, "graphql-js");
  await cp(join(repository, "graphql-js"), workflow, {
    recursive: true,
    filter: path => !["orig", "patched", "transformed"].some(name => path === join(repository, "graphql-js", name)),
  });
  await writeFile(join(workflow, "changes.patch"), "");
  await symlink(join(repository, "src"), join(directory, "src"), "dir");
  const orig = join(workflow, "orig");
  await mkdir(join(orig, "src/__tests__"), { recursive: true });
  await writeFile(join(orig, ".gitignore"), "node_modules\n");
  await writeFile(join(orig, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "esnext", module: "nodenext", types: [], strict: true },
    include: ["src/**/*.ts"],
  }));
  await writeFile(join(orig, "package.json"), '{"name":"fixture","type":"module"}\n');
  const original = "function helper(): number { return 1; }\nexport function work(): number { return helper(); }\n";
  await writeFile(join(orig, "src/index.ts"), original);
  await writeFile(join(orig, "src/deleted.ts"), "export const deleted = true;\n");
  const testSource = "function helper() { return 1; }\nexport function test() { return helper(); }\n";
  await writeFile(join(orig, "src/__tests__/example.ts"), testSource);
  function git(args: string[], cwd = orig) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  git(["init"]);
  git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Baseline"]);
  function run(name: string, ...args: string[]) {
    return spawnSync(process.execPath, [join(workflow, name + ".mjs"), ...args], {
      cwd: directory, encoding: "utf8",
    });
  }
  function succeeds(name: string, ...args: string[]) {
    const result = run(name, ...args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  succeeds("patch");
  const patched = join(workflow, "patched");
  const edited = original.replace("return 1", "return 2");
  await writeFile(join(patched, "src/index.ts"), edited);
  await writeFile(join(patched, "src/added.ts"), "export const added = true;\n");
  const binary = Buffer.from([0, 1, 2, 255]);
  await writeFile(join(patched, "fixture.bin"), binary);
  await rm(join(patched, "src/deleted.ts"));
  await mkdir(join(patched, "node_modules"));
  await writeFile(join(patched, "node_modules/ignored"), "ignored");
  assert.notEqual(run("patch").status, 0);
  assert.equal(await readFile(join(patched, "src/index.ts"), "utf8"), edited);
  succeeds("update-patches");
  const patch = await readFile(join(workflow, "changes.patch"), "utf8");
  assert.match(patch, /GIT binary patch/);
  assert.doesNotMatch(patch, /node_modules/);
  succeeds("update-patches");
  assert.equal(await readFile(join(workflow, "changes.patch"), "utf8"), patch);
  succeeds("patch", "--force");
  assert.equal(await readFile(join(patched, "src/index.ts"), "utf8"), edited);
  assert.deepEqual(await readFile(join(patched, "fixture.bin")), binary);
  await assert.rejects(readFile(join(patched, "src/deleted.ts")), { code: "ENOENT" });
  succeeds("transform");
  const transformed = join(workflow, "transformed");
  assert.match(await readFile(join(transformed, "src/index.ts"), "utf8"), /makeSchedulable/);
  assert.equal(await readFile(join(transformed, "src/__tests__/example.ts"), "utf8"), testSource);
  assert.equal(await readFile(join(transformed, "package.json"), "utf8"), await readFile(join(patched, "package.json"), "utf8"));
  await assert.rejects(readFile(join(transformed, ".git/HEAD")), { code: "ENOENT" });
  await writeFile(join(transformed, "src/stale.ts"), "stale");
  succeeds("transform");
  await assert.rejects(readFile(join(transformed, "src/stale.ts")), { code: "ENOENT" });
  assert.equal(await readFile(join(orig, "src/index.ts"), "utf8"), original);
});
