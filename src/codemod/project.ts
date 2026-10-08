/// <reference types="node" />
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { API } from "typescript/unstable/sync";
import { analyze } from "./analyze.ts";
import type { Exclusion } from "./analyze.ts";
import { transformSource } from "./index.ts";
import type { CodemodOptions } from "./index.ts";

export interface ProjectOptions extends CodemodOptions {
  tsconfig: string;
  sourceDirectory: string;
  outputDirectory: string;
  exclude?: Exclusion[];
}

/** Write a transformed source tree; compile this tree to emit JS and declarations. */
export async function transformProject(options: ProjectOptions): Promise<void> {
  const sourceRoot = resolve(options.sourceDirectory);
  const outputRoot = resolve(options.outputDirectory);
  function contains(parent: string, child: string) {
    const path = relative(parent, child);
    return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  }
  if (contains(sourceRoot, outputRoot) || contains(outputRoot, sourceRoot)) {
    throw new Error("Source and output directories must be separate, without nesting.");
  }
  const api = new API();
  try {
    const config = resolve(options.tsconfig);
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const loadedProject = snapshot.getProject(config);
    if (!loadedProject) throw new Error(`Cannot load TypeScript project: ${config}`);
    const project = loadedProject;
    await mkdir(dirname(outputRoot), { recursive: true });
    await mkdir(outputRoot);
    async function convert(directory: string): Promise<void> {
      for (const entry of await readdir(join(sourceRoot, directory), { withFileTypes: true })) {
        const path = join(directory, entry.name);
        const sourcePath = join(sourceRoot, path);
        const target = join(outputRoot, path);
        if (entry.isDirectory()) {
          await mkdir(target);
          await convert(path);
        } else if (entry.isFile() && /\.(?:m|c)?ts$/.test(entry.name) && !/\.d\.(?:m|c)?ts$/.test(entry.name)) {
          const source = project.program.getSourceFile(sourcePath);
          if (!source) throw new Error(`Source is not included in the TypeScript project: ${sourcePath}`);
          const analysis = analyze(project, source, sourceRoot, options.exclude ?? []);
          await writeFile(target, transformSource(await readFile(sourcePath, "utf8"), sourcePath, options, analysis));
        } else {
          await cp(sourcePath, target);
        }
      }
    }
    await convert("");
  } finally {
    api.close();
  }
}
