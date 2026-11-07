# F003 notes

Map and decisions for `examples/shop`, built on `@keystone-6/core` 6.5.3 and `@keystone-6/auth` 8.1.0.

## Decisions

- The Admin UI lives at `/admin` (`ui.basePath`). Keystone runs `extendExpressApp` before it mounts the Admin UI, so a storefront route at `/` hides the Admin UI dashboard at `/`. `/signin` still works: Keystone answers `302` to `/admin/signin`. After sign-in, the Admin UI goes to `/admin`.
- `ui.isAccessAllowed` lets only admins into the Admin UI. A customer who signs in there gets `/admin/no-access`. Customers use the storefront and `/mcp`.
- One auth list, `User`, with `isAdmin`. A customer is a user without `isAdmin`. `sessionData` is `name isAdmin`.
- Prices are integers in cents (`priceCents`). The name tells Claude the unit; the `decimal` field type does not run on SQLite.
- `session.secret` comes from `SESSION_SECRET`. Without it, `statelessSessions` makes a random secret at each start.
- The seed runs in `db.onConnect` with `context.sudo()`, outside any request. It runs only when the `User` list is empty, and it is not atomic: if it fails part way, delete `keystone.db` and start again.
- `schema.graphql` and `schema.prisma` are committed, as in Keystone's own examples. `keystone dev` rewrites them.

## Package limits seen from the example

No package defect found. One limit shapes how Claude answers questions about orders:

- `callTool` paths go one level deep (`selectablePaths` in `src/catalog.ts`). `orders` can select `lines.quantity` but not `lines.product.name`. For "What has Carl ordered?", Claude must query `orderLines` and select `product.name` and `order.createdAt`. A deeper path is a package change, out of scope here.
