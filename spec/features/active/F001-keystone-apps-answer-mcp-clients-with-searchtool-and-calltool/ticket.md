---
touches:
  - keystone-mcp.catalog
  - keystone-mcp.search
  - keystone-mcp.call
  - keystone-mcp.server
  - keystone-mcp.mount
opened: 2026-11-06
---

# F001 · Keystone apps answer MCP clients with searchTool and callTool

## Outcome

A Keystone app author installs the `keystone-mcp` npm package and passes `keystoneMcp()` to `server.extendExpressApp`. The app then answers `POST /mcp` with two MCP tools. `searchTool` finds the GraphQL queries and mutations of the app, with their argument signatures and selectable field paths. `callTool` runs one of these operations as the session of the request.

## Scope

- The package lives in its own checkout at `/Users/wolf/sources/keystone-mcp`.
- The public export is `keystoneMcp(options?)`. `options.path` defaults to `/mcp`, `options.queriesOnly` defaults to `false`, and `options.takeLimit` defaults to `50`.
- The hook reads `context.graphql.schema` and builds an operation catalog from the query and mutation roots. The catalog skips the root field `keystone`.
- Input-type summaries walk two levels. They omit the fields `AND`, `OR` and `NOT`, and an input object that has a field `every`, `some` or `none`.
- Selectable paths are the scalar and enum fields of the return type, plus one level of scalar and enum fields on object and list-of-object fields. An output field with a non-null argument and no default is not a path.
- `searchTool` scores name, description, return type and field paths. The default limit is 10, and the maximum limit is 25.
- `searchTool` follows Apollo's introspection default: off when `NODE_ENV=production`, on otherwise. `options.introspection` overrides it, as Apollo's `introspection` option does. If the app's own Apollo introspection setting is reachable through public API, it decides instead.
- `callTool` turns one catalog entry into a GraphQL document, clamps `take` to `takeLimit`, and runs the document with `context.withRequest` and then `context.graphql.run`.
- The mount uses `extendExpressApp` only, and attaches the JSON parser on the MCP path only.

## Out of scope

- Changes to `packages/core` in the Keystone checkout. The package does not modify `@keystone-6/core`, and it is not a pull request to `keystonejs/keystone`.
- Publishing to npm. The package is usable through a `file:` dependency until a publish is requested.
- A tool that searches list rows. Row search is a `callTool` invocation of a list query such as `posts`.

## Acceptance

- `npm test` and `npm run build` pass in `/Users/wolf/sources/keystone-mcp`, and `dist/index.js` and `dist/index.d.ts` exist.
- A Keystone app that passes `keystoneMcp()` to `server.extendExpressApp` answers `POST /mcp` with tools named `searchTool` and `callTool`.
- `searchTool` with text `posts` returns the `posts` operation, its argument signatures, and its selectable paths.
- `callTool` for `posts` with `take: 80` runs a document whose `take` variable is `50`, through the context that `withRequest` returns.
- `callTool` with an unknown operation name returns an MCP tool error that names `searchTool`.
- With `NODE_ENV=production` and no override, `searchTool` returns a tool error that names the way to turn it on, and `callTool` still runs.
- With `NODE_ENV=production` and `introspection: true`, `searchTool` with text `posts` returns the `posts` operation.
- `GET /mcp` and `DELETE /mcp` respond 405 with JSON-RPC code `-32000` and message `Method not allowed.`.
- The handler does not call `sudo` or `internal`, and the package does not register `extendHttpServer`.

## Notes

- Stack: TypeScript, Node 18 or later, `graphql` 16, `express` 4, `@modelcontextprotocol/sdk` 1.32.2, `zod` 3.25, Vitest.
- Dev rebuilds call `extendExpressApp` again and drop `extendHttpServer`. For this reason the mount uses `extendExpressApp`.
- Each `POST /mcp` creates a new MCP server and a stateless `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`).
- `statelessSessions` accepts `Authorization: Bearer` and the session cookie. MCP clients send the bearer token.
- The plan holds six tasks with exact tests and file layout: scaffold, catalog, search, call, server, and the Express mount with the README. Task 1 step 1 (`git init`) is done.
- Source: https://app.notion.com/p/keystone-mcp-implementation-plan-40fdf4935ecd8169939ef4e4ae4017ba
- The Notion page needs a login, so a worker cannot read it. This ticket and `.agents/limen/styleguide.md` are the contract.
- Live proof uses a scratch Keystone 6 app at `/tmp/keystone-mcp-smoke`, outside Git, with SQLite and a `file:` dependency on the worktree. Delete it after the feature closes.
