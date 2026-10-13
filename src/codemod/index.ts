import { transformFromAstSync } from "@babel/core";
import { parse, print, types } from "recast";
import * as typescriptParser from "recast/parsers/typescript.js";
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
  const ast = parse(source, { parser: typescriptParser });
  transformFromAstSync(ast, source, {
    filename,
    configFile: false,
    babelrc: false,
    cloneInputAst: false,
    code: false,
    ast: true,
    plugins: [[schedulerTransform, { ...options, analysis }]],
  });
  types.visit(ast, {
    visitTemplateLiteral(path) {
      // Reprint literal contents without reindenting their significant whitespace.
      Object.defineProperty(path.node, "original", { value: null });
      for (const quasi of path.node.quasis) Object.defineProperty(quasi, "original", { value: null });
      this.traverse(path);
    },
    visitYieldExpression(path) {
      // Preserve yield precedence when Recast reuses a surrounding type assertion.
      if (path.parentPath.node.type === "TSAsExpression" || path.parentPath.node.type === "TSSatisfiesExpression") {
        path.replace(types.builders.parenthesizedExpression(path.node));
        return false;
      }
      this.traverse(path);
    },
  });
  return print(ast, { tabWidth: 2, quote: "auto", lineTerminator: source.includes("\r\n") ? "\r\n" : "\n" }).code;
}
