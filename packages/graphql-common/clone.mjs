import { parseArgs } from "node:util";
import { git, orig } from "./common.mjs";

const { positionals: [ref, ...extra] } = parseArgs({ allowPositionals: true });
if (extra.length) throw new Error("Usage: node packages/graphql-common/clone.mjs [branch-or-tag]");

git([
  "clone",
  ...(ref ? ["--branch", ref] : []),
  "--", "https://github.com/graphql/graphql-js.git", orig,
]);
console.log(`Cloned GraphQL.js at ${git(["rev-parse", "HEAD"], orig).trim()}`);
