---
opened: 2026-11-07
---

# F007 · The shop example runs on current Keystone with no known vulnerabilities

## Outcome

A reader who clones the repository and starts the shop example gets an app on current Keystone (core 8.3, auth 10) with no known vulnerability in its dependencies. Today the example asks for Keystone 6.5 and auth 8.1, and its lockfile carries all 39 open Dependabot alerts of the repository (Next.js, postcss, image-size, @apollo/server and others). Each of those alerts has a patched version that Keystone 8.3 already pulls.

## Scope

- `examples/shop` only: `package.json`, a fresh `package-lock.json`, and the code changes that Keystone 8 and Prisma 7 need.
- Start at `examples/shop/package.json`, then `keystone.ts`. Prisma 7 needs a database adapter for SQLite; `test/keystone/keystone.ts` in the root shows a working Keystone 8.3 setup with `@prisma/adapter-better-sqlite3`.
- Keep what the example shows: the storefront at `/`, the Admin UI at `/admin`, the MCP endpoint at `/mcp`, the seed data, the access rules, and `trust proxy`.
- Regenerate `schema.graphql` and `schema.prisma` if Keystone 8 changes them, and update the example README where versions or start steps change.

## Out of scope

- The published package in `src/` and the root `package.json`.
- New features or new lists in the example.
- Dependabot configuration or alert dismissals.

## Acceptance

- `npm audit` in `examples/shop` reports 0 vulnerabilities.
- After the root `npm run build`, the README's start steps run the example: `npm run dev` creates `keystone.db` with the seed data, and `/` lists the seed products.
- `/admin` serves the Admin UI to a seed admin who signs in.
- An MCP client that signs in as a seed customer through `/mcp` reads the seed products with `callTool`.
- The same customer reads only its own orders with `callTool`.
- `npm run build` in `examples/shop` passes.

## Notes

- Keystone checkout for reference, read only: `../keystone` (8.3.0). Search it with `jg "<question>" ../keystone`.
