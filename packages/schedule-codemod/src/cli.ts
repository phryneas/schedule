#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { transformProject } from "./project.ts";
import type { ProjectOptions } from "./project.ts";

const { positionals: [config, ...extra] } = parseArgs({ allowPositionals: true });
if (!config || extra.length) {
  throw new Error("Usage: schedule-codemod <config.json>");
}
await transformProject(JSON.parse(await readFile(config, "utf8")) as ProjectOptions);
