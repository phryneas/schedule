# GraphQL.js workflow

Run these commands from the scheduling repository root using Node.js 24.
The scripts also work from other directories when invoked by their full path.

```sh
# Clone a supported upstream release, including history needed for replay.
node graphql-js/clone.mjs v17.0.2

# Replay the 17.x patch lane and configure package files.
node graphql-js/patch.mjs
npm ci --prefix graphql-js/patched
```

The `17` lane starts at `v17.0.0`; the `16` lane starts at `v16.14.2`.
Each lane's exact base commit and ordered patch files are recorded in its
`lane.json`, with independent patches and resolutions using the same scripts.
The script selects the lane from the upstream package's major version and
rejects unsupported majors before replacing an existing `patched` checkout.

Lane replay creates patch commits on the recorded base and rebases them onto
the release checked out in `orig`. Known conflict resolutions are copied from
the lane's tracked `resolutions` directory into the disposable checkout's Git
rerere cache. Unknown conflicts stop replay and leave `patched` ready to edit.
Resolve the listed files, stage those files with `git add`, and run:

```sh
node graphql-js/patch.mjs --continue
```

After transforming and validating the result, save newly learned resolutions:

```sh
node graphql-js/update-patches.mjs --resolutions
```

Commit the exported resolution records with the workflow changes. They contain
conflicted and resolved source files, including any numbered variants Git needs.
Temporary and unresolved cache entries are not exported. Normal replay never
updates the tracked records. Use a consistent Git version in automation; replay
is tested with Git 2.54.0. A reused resolution still needs build/test validation.

To edit a lane's starting patch, prepare its base release, edit `patched`, and run
`update-patches.mjs`. On later releases, that command only permits exporting
resolutions with `--resolutions`, to avoid replacing the base patch with a
release-specific diff. The optional additional tests are retained in `tests.patch`
for reference but are not currently applied by the workflow.

Existing shallow `orig` checkouts need the base's history fetched before lane
replay. New `clone.mjs` checkouts include it. Replay itself makes no network calls.

Adaptations to existing upstream tests and integration setup remain in the
lane's starting patch.
Package manifests are configured with `npm pkg set`, and npm updates the root
lockfile without installing dependencies. Set `SCHEDULE_PACKAGE` to override
the schedule dependency (for example, an absolute `file:` path for local work).

The v16 fork retains its CJS/ESM output formats but uses Node 24+ and modern
TypeScript/Babel tooling. It requires TypeScript 6.0+; its declaration tests use
`nodenext` resolution. Generated declarations use TypeScript's own formatting.

At the lane's base release, edit `patched`, including the memoization adaptations and
`// @phryneas/schedule may-yield-here` comments. Save those changes with:

```sh
node graphql-js/update-patches.mjs
```

This updates the lane's `changes.patch` from its base commit, including added files,
deletions, and binary changes. It stages changes in the
`patched` checkout. Commits made there are included too. Ignored files are omitted.
`package.json` and `package-lock.json` files are excluded from the patch.
Make persistent package changes in `patch.mjs`.

```sh
# Recreate patched from orig and the saved patch, discarding its current contents.
node graphql-js/patch.mjs --force
npm ci --prefix graphql-js/patched

# Replace transformed with a copy of patched and codemod its src directory.
node graphql-js/transform.mjs
```

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

The entire `graphql-js` directory is outside the published packages.

`packages/graphql-16` and `packages/graphql-17` are private build workspaces.
Their `prebuild` scripts prepare the latest stable release in their own ignored
`.tmp` directories; their `build` scripts check types, run runtime tests, and
produce complete npm packages in `dist`. Publish those `dist` directories, not
the private workspace manifests. The upstream package exports are preserved.

The root `npm run build` builds the scheduler and codemod first, then both GraphQL
workspaces. To rebuild just one GraphQL major after building those dependencies:

```sh
npm run build -w @phryneas/scheduled-graphql-16
```

The manual scripts still use `graphql-js/orig`, `patched`, and `transformed` by
default. `GRAPHQL_WORK_DIR` selects another working directory; the workspace
builds use this to leave manual checkouts untouched.

On each push, `preview.yml` also builds the latest stable npm release of GraphQL
16 and 17 using these lanes. Both must pass TypeScript checks and runtime tests
before publishing. The GraphQL packages and workspace packages are published
together, so each GraphQL preview depends on the scheduler from the same commit.
The built previews are named `@phryneas/scheduled-graphql-16` and
`@phryneas/scheduled-graphql-17` to distinguish the two majors.
The workflow summary records the upstream versions used.
