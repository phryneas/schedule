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
  const workflow = join(directory, "packages/graphql-common");
  await cp(join(repository, "packages/graphql-common"), workflow, {
    recursive: true,
    filter: path => !["orig", "patched", "transformed"].some(name => path === join(repository, "packages/graphql-common", name)),
  });
  await symlink(join(repository, "packages/schedule-codemod"), join(directory, "packages/schedule-codemod"), "dir");
  const orig = join(workflow, "orig");
  await mkdir(join(orig, "src/__tests__"), { recursive: true });
  await writeFile(join(orig, ".gitignore"), "node_modules\n");
  await writeFile(join(orig, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "esnext", module: "nodenext", types: [], strict: true },
    include: ["src/**/*.ts"],
  }));
  await writeFile(join(orig, "package.json"), JSON.stringify({
    name: "fixture", version: "17.0.0", type: "module",
    engines: { node: "^22.0.0 || ^24.0.0 || >=26.0.0" },
    scripts: {
      check: "npm run check:ts && npm run check:deno && npm run extra",
      "testonly:cover": "node --test --test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100",
      "check:spelling": 'cspell --cache "**/*"',
    },
  }));
  const schedule = join(directory, "schedule-fixture");
  await mkdir(schedule);
  await writeFile(join(schedule, "package.json"), '{"name":"@phryneas/schedule","version":"0.0.1"}\n');
  for (const name of ["dev-jest", "ts"]) {
    await mkdir(join(orig, "integrationTests", name), { recursive: true });
  }
  await writeFile(join(orig, "integrationTests/dev-jest/package.json"), '{"private":true,"devDependencies":{"jest":"^29.7.0"}}\n');
  await writeFile(join(orig, "integrationTests/ts/package.json"), JSON.stringify({
    private: true, dependencies: { "typescript-4.9": "npm:typescript@4.9.x", "typescript-6.0": "npm:typescript@6.0.x" },
  }));
  const original = "function helper(): number { return 1; }\nexport function work(): number {\n// @phryneas/schedule may-yield-here\nreturn helper();\n}\n";
  await writeFile(join(orig, "src/index.ts"), original);
  await writeFile(join(orig, "src/deleted.ts"), "export const deleted = true;\n");
  const testSource = "function helper() { return 1; }\nexport function test() { return helper(); }\n";
  await writeFile(join(orig, "src/__tests__/example.ts"), testSource);
  const optionalTest = "src/language/__tests__/parser-test.ts";
  await mkdir(join(orig, "src/language/__tests__"), { recursive: true });
  await writeFile(join(orig, optionalTest), testSource);
  function git(args: string[], cwd = orig) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  git(["init"]);
  git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Baseline"]);
  const lane = join(directory, "packages/graphql-17");
  await mkdir(lane, { recursive: true });
  await writeFile(join(lane, "lane.json"), JSON.stringify({
    major: 17, base: git(["rev-parse", "HEAD"]).trim(), patches: ["changes.patch"],
  }));
  await writeFile(join(lane, "changes.patch"), "");
  function run(name: string, ...args: string[]) {
    return spawnSync(process.execPath, [join(workflow, name + ".mjs"), ...args], {
      cwd: directory, encoding: "utf8",
      env: { ...process.env, SCHEDULE_PACKAGE: `file:${schedule}` },
    });
  }
  function succeeds(name: string, ...args: string[]) {
    const result = run(name, ...args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  for (const name of ["clone", "patch", "update-patches", "transform"]) {
    const invalid = run(name, "--unknown-option");
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /ERR_PARSE_ARGS_UNKNOWN_OPTION/);
  }
  for (const name of ["patch", "update-patches", "transform"]) {
    const invalid = run(name, "unexpected");
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL/);
  }
  succeeds("patch");
  const patched = join(workflow, "patched");
  assert.equal(git(["config", "--get", "schedule.lane"], patched).trim(), "17");
  await assert.rejects(readFile(join(workflow, "changes.patch")), { code: "ENOENT" });
  const configured = JSON.parse(await readFile(join(patched, "package.json"), "utf8"));
  assert.equal(configured.name, "@phryneas/scheduled-graphql");
  assert.equal(configured.version, "17.0.0");
  assert.equal(configured.engines.node, "^24.0.0 || >=26.0.0");
  assert.equal(configured.scripts.check, "npm run check:ts && npm run extra");
  assert.match(configured.scripts["testonly:cover"], /--test-coverage-lines=97 --test-coverage-branches=97 --test-coverage-functions=100/);
  assert.equal(configured.scripts["check:spelling"], 'cspell --gitignore-root . --cache "**/*"');
  assert.equal(configured.dependencies["@phryneas/schedule"], `file:${schedule}`);
  const lock = JSON.parse(await readFile(join(patched, "package-lock.json"), "utf8"));
  assert.equal(lock.packages[""].name, configured.name);
  const tsDependencies = JSON.parse(await readFile(join(patched, "integrationTests/ts/package.json"), "utf8")).dependencies;
  assert.equal(tsDependencies["typescript-4.9"], undefined);
  assert.equal(tsDependencies["typescript-6.0"], "npm:typescript@6.0.x");
  const jestDependencies = JSON.parse(await readFile(join(patched, "integrationTests/dev-jest/package.json"), "utf8")).devDependencies;
  assert.equal(jestDependencies.jest, "^29.7.0");
  assert.equal(jestDependencies["@babel/plugin-transform-modules-commonjs"], "^7.27.1");
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
  const patch = await readFile(join(lane, "changes.patch"), "utf8");
  assert.match(patch, /GIT binary patch/);
  assert.doesNotMatch(patch, /node_modules/);
  assert.doesNotMatch(patch, /parser-test/);
  assert.doesNotMatch(patch, /package(?:-lock)?\.json/);
  succeeds("update-patches");
  assert.equal(await readFile(join(lane, "changes.patch"), "utf8"), patch);
  succeeds("patch", "--force");
  assert.equal(await readFile(join(patched, optionalTest), "utf8"), testSource);
  succeeds("update-patches");
  assert.equal(await readFile(join(lane, "changes.patch"), "utf8"), patch);
  await writeFile(join(patched, optionalTest), testSource.replace("return 1", "return 3"));
  assert.notEqual(run("update-patches").status, 0);
  assert.equal(await readFile(join(lane, "changes.patch"), "utf8"), patch);
  succeeds("patch", "--force");
  succeeds("update-patches");
  assert.equal(await readFile(join(lane, "changes.patch"), "utf8"), patch);
  assert.equal(await readFile(join(patched, "src/index.ts"), "utf8"), edited);
  assert.deepEqual(await readFile(join(patched, "fixture.bin")), binary);
  await assert.rejects(readFile(join(patched, "src/deleted.ts")), { code: "ENOENT" });
  succeeds("transform");
  const transformed = join(workflow, "transformed");
  assert.match(await readFile(join(transformed, "src/index.ts"), "utf8"), /makeSchedulable/);
  assert.equal(await readFile(join(transformed, "src/__tests__/example.ts"), "utf8"),
    "function helper() {\n  return 1;\n}\nexport function test() {\n  return helper();\n}\n");
  assert.equal(await readFile(join(transformed, "package.json"), "utf8"), await readFile(join(patched, "package.json"), "utf8"));
  await assert.rejects(readFile(join(transformed, ".git/HEAD")), { code: "ENOENT" });
  await writeFile(join(transformed, "src/stale.ts"), "stale");
  succeeds("transform");
  await assert.rejects(readFile(join(transformed, "src/stale.ts")), { code: "ENOENT" });
  assert.equal(await readFile(join(orig, "src/index.ts"), "utf8"), original);
  succeeds("update-patches", "--resolutions");
  // Unsupported majors must fail before --force can remove existing work.
  const upstreamManifest = JSON.parse(await readFile(join(orig, "package.json"), "utf8"));
  upstreamManifest.version = "18.0.0";
  await writeFile(join(orig, "package.json"), JSON.stringify(upstreamManifest));
  git(["add", "package.json"]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Unsupported major"]);
  const unsupported = run("patch", "--force");
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /No patch lane for GraphQL 18.0.0/);
  assert.equal(await readFile(join(patched, "src/index.ts"), "utf8"), edited);
});
