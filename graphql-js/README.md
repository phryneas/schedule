# GraphQL.js workflow

Run these commands from the scheduling repository root using Node.js 24.
The scripts also work from other directories when invoked by their full path.

```sh
# Clone upstream's default branch, or supply a branch/tag such as v16.14.2.
node graphql-js/clone.mjs

# Copy the clean checkout and apply changes.patch.
node graphql-js/patch.mjs
npm ci --prefix graphql-js/patched
```

Edit `patched`, including the memoization adaptations and
`// @phryneas/schedule may-yield-here` comments. Save those changes with:

```sh
node graphql-js/update-patches.mjs
```

This replaces `changes.patch` with the complete diff from the original commit,
including added files, deletions, and binary changes. It stages changes in the
`patched` checkout. Commits made there are included too. Ignored files are omitted.

```sh
# Recreate patched from orig and the saved patch, discarding its current contents.
node graphql-js/patch.mjs --force
npm ci --prefix graphql-js/patched

# Replace transformed with a copy of patched and codemod its src directory.
node graphql-js/transform.mjs
```

The transform copies tests and test helpers unchanged. Its exclusions are in
`codemod.json`. Package files and build configuration are copied from `patched`;
make persistent edits there rather than in `transformed`. Dependencies and Git
metadata are not copied. Install dependencies in `transformed` separately when
building it, including `@phryneas/schedule` as required by its generated imports.

`orig`, `patched`, and `transformed` are ignored by Git. Keep `orig` clean: local
uncommitted edits there are not copied into `patched`. To change upstream versions,
save your patch, remove `orig`, and clone again with the desired branch or tag.

The entire `graphql-js` directory is outside both workspace packages. Each
package's `files` allowlist includes only `dist`.
