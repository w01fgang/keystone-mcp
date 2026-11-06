# Vision

> Human-owned durable intent for every role. Keep this file at or below 1000 lines. The injected copy is capped at 1000 lines; keep each item high-signal and move supporting history to feature notes. The coordinator may propose changes but does not invent or rewrite this intent unprompted.

## Product principles

- `keystone-mcp` is a standalone npm package. It mounts an MCP endpoint on the existing Express server of a Keystone 6 app.
- The package does not modify `@keystone-6/core`. It uses only the public hook `server.extendExpressApp` and the public context.
- The MCP surface is two tools: `searchTool` finds GraphQL operations, and `callTool` runs one operation.
- The catalog comes from the public GraphQL schema of the app. Access control stays with Keystone: `callTool` runs as the session of the request, never through `sudo` or `internal`.
- The app author controls the surface with three options: `path` (default `/mcp`), `queriesOnly` (default `false`) and `takeLimit` (default `50`).

## Current direction

- Ship the first version of the package (F001): catalog, search, call, MCP server, and the Express mount, with a README for the `keystone.ts` wiring.
- Apps use the package through a `file:` dependency. Publishing to npm waits for an explicit request.
