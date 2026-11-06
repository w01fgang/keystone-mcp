PASS 478866e2b8d60ce7167d54e264cfb620eeb31088

Reviewed commit `478866e2b8d60ce7167d54e264cfb620eeb31088`, the branch tip "F001: ship a CommonJS build for Keystone, the README, and the live proof notes". I saw no proven break of an acceptance bullet. `callTool` runs as the session of each request. Rows and fields reachable through `/mcp` match `/api/graphql`. Four access-control gaps remain, all notes.

## Unverified checks

- **HEAD and clean tree.** I ran `git rev-parse HEAD` and `git status --short`. HEAD printed `478866e…` and status printed no changes. Both calls joined commands with `;`, so Limen will not count them as proof.
- **npm test and npm run build.** I saw 38 of 38 tests pass and the build succeed. Both outputs went through `| tail`, so they count only as an observation. The npm ci output is in `/tmp/rev-ci.log`.
- **Coordinator log `/tmp/f001-lane.log`.** It ran in the worktree `…-on-bf2e8c41`, which no longer exists. It names no commit.
- **Existing smoke app `/tmp/keystone-mcp-smoke`.** Its installed `node_modules/keystone-mcp/dist` was byte-identical to my build when I compared them. That compare ran in a `;` call.
- **Dev rebuild refreshes the catalog.** Not exercised.

## Notes

1. **Proven: `searchTool` shows the schema to anonymous clients when the app turns introspection off.** With `apolloConfig.introspection: false`, `/api/graphql` rejected `__schema` with 400 `INTROSPECTION_DISABLED`. Anonymous `searchTool {text:"users"}` still returned the arguments and field paths. Apollo turns introspection off by default when `NODE_ENV=production`. Evidence: `node probe.mjs`.
2. **Proven: `callTool` returns Prisma error text that Keystone hides.** A duplicate-email `createUser` behaves differently on the two paths:
   - `/mcp` returned "Invalid `prisma.user.create()` invocation … Unique constraint failed on the fields: (`email`)".
   - `/api/graphql` returned "Prisma error" with code `KS_PRISMA_ERROR`.

   The cause is in `src/server.ts`: it returns `error.message` without Keystone's `formatError` mapping.
3. **Proven: a negative `take` gets past `takeLimit`.** `posts {take:-80}` returned 60 rows. `src/call.ts` clamps only when `take > takeLimit`. Clamp the absolute value or reject `take < 0`.
4. **Proven: nested list paths have no limit.** `users {take:1}` with `select ["posts.title"]` returned 60 nested rows. Keystone's per-list `maxTake` still applies.
5. **Proven safe:**
   - Four concurrent `postsCount` calls (anonymous, bearer, anonymous, bearer) returned `[30,60,30,60]`. This matches `/api/graphql`.
   - Field read access holds: `email` is null for anonymous and visible with a bearer token.
   - A list with `graphql.omit` is absent from search and from calls.
   - The `keystone` root field is skipped.
   - A bad bearer token falls back to anonymous, and the create is denied.
   - A cross-site-shaped `text/plain` POST that carries the session cookie got 415.
6. **Proven by reading Keystone 8.3 dist:**
   - The context that `extendExpressApp` receives has `sudo: false` and `internal: false` (`getContext-8d5967c0.js:555-559`).
   - `withRequest` keeps those flags (`:498-511`).
   - Apollo serves the same public schema that the catalog reads (`express-edb9361c.js:552`).
7. **Test quality.** `fakeContext` in `test/schema.ts` makes `commonContext.graphql.run` reject, so the mount test really proves that calls go through the `withRequest` context.

## Checks run

- `npm ci && npm test && npm run build`, with output piped through tail: 38 of 38 tests passed, and the build succeeded.
- I read `src/mount.ts`, `src/server.ts`, `src/call.ts` and the Keystone dist files.
- A live Keystone dev app on port 3912 ran a copy of the smoke app with added access rules. `node probe.mjs` gave the results in notes 1–5. I deleted the copy afterwards.
- A live `node -e` acceptance probe returned `tools/list` = `[searchTool, callTool]`, the `posts` search with its arguments and paths, and 405 with `-32000` for GET and DELETE.

## Note check

- HEAD is 478866e and the tree is clean: not proven. Both git calls used `;`. I did not rerun them.
- callTool runs as the request session: proven. `node probe.mjs` (concurrent `[30,60,30,60]`, email null vs visible) and `src/mount.ts` (`withRequest` inside the POST handler).
- Mount does not widen anonymous reach: not proven. Row, field and operation reach is not widened (`node probe.mjs`). Schema discovery when introspection is off (note 1) and Prisma error text (note 2) are widened.
- Acceptance 1, npm test and build pass and dist files exist: not proven. The test and build output went through `| tail`. Only npm ci has a log, `/tmp/rev-ci.log`.
- Acceptance 2, POST /mcp answers with `searchTool` and `callTool`: proven. `node probe.mjs` called both tools on POST /mcp and got results.
- Acceptance 3, `searchTool posts` returns the operation, its arguments and its paths: not proven. I saw it in a `node -e` call that contained line breaks. `/tmp/keystone-mcp-smoke/proof.md` shows it, but it comes from the deleted worktree.
- Acceptance 4, take 80 runs with take 50 through the `withRequest` context: not proven. `test/mount.test.ts` asserts it, but its passing output was piped.
- Acceptance 5, an unknown operation gives a tool error that names `searchTool`: proven. `node probe.mjs` (`secrets` returned "Unknown operation … Use searchTool …").
- Acceptance 6, GET and DELETE give 405 with `-32000` and "Method not allowed.": not proven. I saw it in the `node -e` call with line breaks.
- Acceptance 7, no `sudo` or `internal` and no `extendHttpServer`: not proven. `cat src/mount.ts src/server.ts src/call.ts src/types.ts src/index.ts package.json` shows none of them in the handler files. The grep across all of `src`, including `catalog.ts` and `search.ts`, ran in a `;`/`||` call.
- Easy-to-miss rule, "callTool must run as the session of the request": followed. `node probe.mjs` interleaved anonymous and bearer calls concurrently and got `[30,60,30,60]`. `src/mount.ts` creates the context and the server inside each POST.
