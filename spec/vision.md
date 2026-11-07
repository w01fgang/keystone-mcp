# Vision

> Human-owned durable intent for every role. Keep this file at or below 1000 lines. The injected copy is capped at 1000 lines; keep each item high-signal and move supporting history to feature notes. The coordinator may propose changes but does not invent or rewrite this intent unprompted.

## Product principles

- `keystone-mcp` is a standalone npm package. It mounts an MCP endpoint on the existing Express server of a Keystone 6 app.
- The package does not modify `@keystone-6/core`. It uses only the public hook `server.extendExpressApp` and the public context.
- The MCP surface is two tools: `searchTool` finds GraphQL operations, and `callTool` runs one operation.
- What the agent reads tells it about the project, not the technology under it: no Keystone, GraphQL or Prisma in the instructions, tool text or errors; an error code or message that exposes internals is replaced (owner, 2026-11-07).
- The catalog comes from the public GraphQL schema of the app. Access control stays with Keystone: `callTool` runs as the session of the request, never through `sudo` or `internal`.
- The app author controls the surface with five options: `path` (default `/mcp`), `queriesOnly` (default `false`), `takeLimit` (default `50`), `introspection` (default: off when `NODE_ENV=production`, on otherwise, as Apollo's default) and `instructions` (a paragraph about the project, default none).

## Current direction

- Ship the first version of the package (F001): catalog, search, call, MCP server, and the Express mount, with a README for the `keystone.ts` wiring.
- `keystone-mcp` 0.1.0 is on npm (2026-11-07). Apps install it with `npm install keystone-mcp`; the source is https://github.com/w01fgang/keystone-mcp.
