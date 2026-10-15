import { git, orig } from "./common.mjs";

const [ref, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error("Usage: node graphql-js/clone.mjs [branch-or-tag]");

git([
  "clone", "--depth", "1",
  ...(ref ? ["--branch", ref] : []),
  "--", "https://github.com/graphql/graphql-js.git", orig,
]);
console.log(`Cloned GraphQL.js at ${git(["rev-parse", "HEAD"], orig).trim()}`);
