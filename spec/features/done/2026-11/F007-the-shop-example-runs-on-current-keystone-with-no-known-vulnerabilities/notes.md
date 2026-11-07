# F007 notes

## Decisions

- `examples/shop/package.json` lists what the example imports or needs at run time: `@keystone-6/core` ^8.3.0, `@keystone-6/auth` ^10.0.6, `@prisma/adapter-better-sqlite3` ^7.10.1, `better-sqlite3` ^12.11.1 (an optional peer of core, so npm does not install it alone), and `keystone-mcp`. npm installs the other peers of Keystone (`prisma`, `@prisma/client`, `next`, `react`, `react-dom`, `@keystar/ui`) by itself; the lockfile pins them.
- Prisma 7 has no `url` in `schema.prisma`. Two files name the database, and both say `file:./keystone.db`:
  - `keystone.ts` opens it at run time through `PrismaBetterSqlite3` in `db.prismaClientOptions`.
  - `prisma.config.ts` gives it to `prisma db push`, which `keystone dev` runs at start. Without this file, Keystone writes one that reads `DATABASE_URL`, which the example does not set.
- Keystone 8 writes the Prisma client and `generated/keystone/types.ts` into `generated/`. `.gitignore` ignores it, as Keystone's own repository and `test/keystone/.gitignore` do.
- `schema.graphql` and `schema.prisma` are the files that `keystone dev` regenerated (relationship `set` inputs, `authenticatedItem: User`, new admin meta, the `prisma-client` generator).
- No change was needed in `schema.ts`, `seed.ts` or `storefront.ts`. `db.onConnect` still runs the seed.

## What was run (2026-11-07, Node.js 24.22.1, npm 11.6.2)

1. Root: `npm run build`.
2. `examples/shop`: `rm -rf node_modules package-lock.json && npm install` made the new lockfile. Then a second clean run from that lockfile: `rm -rf node_modules keystone.db generated .keystone && npm install`. Both: 424 packages, `found 0 vulnerabilities`; `npm audit`: `found 0 vulnerabilities`.
3. `npm run dev`: the log shows `SQLite database keystone.db created`, `Seeded the shop.`, `GraphQL API ready`, `Admin UI ready`.
4. Storefront: `curl http://localhost:3000/` → 200 with six product links (the published seed products; the two drafts are hidden). `/products/earl-grey` → 200.
5. Admin UI: `/admin` → 302 to `/admin/signin`. In headless Chromium, sign-in as `admin@example.com` opens the dashboard: Users 3, Categories 3, Products 8, Orders 4, Order Lines 6.
6. MCP: a Node script with the MCP SDK client (`StreamableHTTPClientTransport` and an `OAuthClientProvider`) registers a client, posts the sign-in form of `/mcp/oauth/signin` as the user, exchanges the code, and calls `callTool`. As `carl@example.com`: `products` returns the six published products; `orders` returns two orders, both with `customer.email` `carl@example.com`; `orderLines` returns only the four lines of those two orders; `users` returns only Carl. As `dana@example.com`: two other orders, both Dana's.
7. `npm run build` in `examples/shop`: exit 0.
8. `NODE_ENV=production SESSION_SECRET=… npm start`: `/` → 200, `/admin` → 302 to sign-in, and the MCP script as Carl again reads only Carl's two orders.

The script and its output are kept outside the repository, in the job folder `.limen/jobs/2026-11-07-f007-shop-example-on-keystone-8-b8540b55/` of the main checkout (`mcp-customer.mjs`, `f007-mcp-carl.txt`, `f007-mcp-dana.txt`). Run it from the repository root, so that it finds `@modelcontextprotocol/sdk`: `node mcp-customer.mjs carl@example.com shop-carl-1234`.

## Seen, not changed

- `npm install` warns that `prebuild-install` 7.1.3 (from `better-sqlite3`) is deprecated. It is not a vulnerability.
- Next.js warns at `npm run dev` that it found two lockfiles (the root one and the example's) and picked the root as workspace root. The Admin UI still builds and serves. Keystone owns the Next.js config, so the example does not set `turbopack.root`.
