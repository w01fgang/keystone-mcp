# F007 outcome

The shop example now runs on Keystone core 8.3, auth 10 and Prisma 7, and `npm audit` in `examples/shop` finds 0 vulnerabilities. Before this change, the old example lockfile held all 39 open Dependabot alerts of the repository. The work landed in `612b051` and was closed in `7af123e`. The published package did not change, so no release was needed.

Prisma 7 opens SQLite through `@prisma/adapter-better-sqlite3`. `keystone.ts` and the new `prisma.config.ts` both name `file:./keystone.db`, so a change to the database file must be made in both files. The coordinator checked a fresh clone: a clean `npm ci` found 0 vulnerabilities, a dev start created and seeded the database, `/` listed six products, `/admin/signin` returned 200, and `/mcp` asked for sign-in. The worker's `notes.md` records the MCP sign-in checks for a customer and for an admin.
