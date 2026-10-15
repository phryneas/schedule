#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { transformProject } from "./project.ts";
import type { ProjectOptions } from "./project.ts";

const [config, ...extra] = process.argv.slice(2);
if (!config || extra.length) {
  throw new Error("Usage: schedule-codemod <config.json>");
}
await transformProject(JSON.parse(await readFile(config, "utf8")) as ProjectOptions);
