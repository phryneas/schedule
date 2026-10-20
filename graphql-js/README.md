# GraphQL.js workflow

Run these commands from the scheduling repository root using Node.js 24.
The scripts also work from other directories when invoked by their full path.

```sh
# Clone upstream's default branch, or supply a branch/tag such as v16.14.2.
node graphql-js/clone.mjs

# Copy the clean checkout, apply changes.patch, and configure package files.
node graphql-js/patch.mjs
npm ci --prefix graphql-js/patched
```

Use `node graphql-js/patch.mjs --with-additional-tests` to also apply `tests.patch`,
which adds scheduler regression tests for parsing and visiting. Adaptations to
existing upstream tests and integration setup remain in `changes.patch`.
Package manifests are configured with `npm pkg set`, and npm updates the root
lockfile without installing dependencies. Set `SCHEDULE_PACKAGE` to override
the schedule dependency (for example, an absolute `file:` path for local work).

Edit `patched`, including the memoization adaptations and
`// @phryneas/schedule may-yield-here` comments. Save those changes with:

```sh
node graphql-js/update-patches.mjs
```

This updates `changes.patch` from the original commit, including added files,
deletions, and binary changes. For a checkout prepared with `--with-additional-tests`, it
saves the parser/visitor test changes separately in `tests.patch`. Otherwise,
the saved test patch is left unchanged. It stages changes in the
`patched` checkout. Commits made there are included too. Ignored files are omitted.
`package.json` and `package-lock.json` files are excluded from both patches.
Make persistent package changes in `patch.mjs`.

```sh
# Recreate patched from orig and the saved patch, discarding its current contents.
node graphql-js/patch.mjs --force
npm ci --prefix graphql-js/patched

# Replace transformed with a copy of patched and codemod its src directory.
node graphql-js/transform.mjs
```

Add `--with-additional-tests` when recreating `patched` to include the optional tests again.

The codemod skips tests and test helpers. Its exclusions are in `codemod.json`.
After transformation, the script formats `transformed/src` using the workspace's
Prettier dependency and the copied GraphQL.js formatting configuration.
Package files and build configuration are copied from `patched`;
make other persistent edits there rather than in `transformed`. Dependencies and Git
metadata are not copied. Install dependencies in `transformed` separately when
building it, including `@phryneas/schedule` as required by its generated imports.

`orig`, `patched`, and `transformed` are ignored by Git. Keep `orig` clean: local
uncommitted edits there are not copied into `patched`. To change upstream versions,
save your patch, remove `orig`, and clone again with the desired branch or tag.

The entire `graphql-js` directory is outside both workspace packages. Each
package's `files` allowlist includes only `dist`.
