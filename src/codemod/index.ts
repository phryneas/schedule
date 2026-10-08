import { transformSync } from "@babel/core";
import schedulerTransform from "./transform.ts";
import type { SourceAnalysis } from "./analyze.ts";

export { transformProject } from "./project.ts";
export type { ProjectOptions } from "./project.ts";
export type { Exclusion } from "./analyze.ts";

export interface CodemodOptions {
  /** Import path used by the transformed source. */
  runtimeModule?: string;
}

/** Transform source before compiling JavaScript and generating declarations. */
export function transformSource(
  source: string,
  filename: string,
  options: CodemodOptions = {},
  analysis?: SourceAnalysis,
): string {
  return transformSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ["typescript"] },
    plugins: [[schedulerTransform, { ...options, analysis }]],
  })!.code! + "\n";
}
