# Styleguide

> Project-owned coding practice for every coordinator, worker, and reviewer turn. Keep this file at or below 1000 lines. The injected copy is capped at 1000 lines. Edit this file to change how agents write and organize code here. It is not product scope and not speech.

## Shape

- One module per responsibility in `src/`: `types.ts`, `catalog.ts`, `search.ts`, `call.ts`, `server.ts`, `mount.ts`. `src/index.ts` only re-exports.
- Pure functions build data (`buildCatalog`, `searchCatalog`, `buildCall`). Only `server.ts` and `mount.ts` touch the MCP SDK and Express.
- Tests live in `test/`, one file per module, and share the GraphQL fixture in `test/schema.ts`.

## Prefer

- TypeScript with `strict`, ES modules (`"type": "module"`, `Node16` resolution), and Vitest.
- A test name states the behavior, for example `it('rejects an unknown field path')`.
- Throw `CallError` for a request that the catalog rejects. The MCP server turns it, and a rejection from `graphql.run`, into a tool result with `isError: true`.
- Exact pinned versions for the MCP SDK (`@modelcontextprotocol/sdk` 1.32.2). `express` and `graphql` are peer dependencies.
- Search code with Jevgrep first: `jg "how does the request context reach graphql.run?" [root]`, here or in the Keystone checkout. Use grep only for an exact symbol, string or filename. When a job delegates discovery, the instruction names `jg` and the root.

## Avoid

- Edits to `@keystone-6/core` or to the Keystone checkout.
- `context.sudo()` and `context.internal` in a request path.
- `extendHttpServer`: dev rebuilds drop it.
- A JSON body parser outside the MCP path. Keystone attaches its own parser on the GraphQL path.
