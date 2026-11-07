---
touches:
  - keystone-mcp.server
  - keystone-mcp.mount
opened: 2026-11-07
---

# F004 · Agents learn what the project is when they connect to /mcp

## Outcome

When an agent such as Claude Desktop connects to `/mcp`, it learns what the project is and what it can do there, in the project's own words: for the example shop, that it holds products, categories, customers and orders, and that it can read, change and delete them. Everything the agent reads from the server describes the project, not the technology under it, so the agent and the admin never see words like Keystone, GraphQL or Prisma. Today the text is generic and names the stack.

## Scope

- The server instructions are built from the catalog: the project's record types in plain words (from the list names, for example "products" and "orders") and the one-record operations for each. They are sent even when `introspection` is off, because only signed-in users reach `/mcp`.
- A new optional `instructions` option: one paragraph by the app author about the project. It comes first, before the generated part.
- The text the agent reads (server instructions, tool descriptions, argument descriptions, and the message when search is off) names no technology: no Keystone, GraphQL, Prisma, `keystone.ts` or package name. The search-off message tells the agent to ask the app's owner to turn search on.
- The README options table and the shop example use the new option, with a short project paragraph.
- Starting seam: `INSTRUCTIONS` and the tool descriptions in `src/server.ts`, and `resolveOptions` in `src/mount.ts`.

## Out of scope

- Error text from a failed call. It stays the same as the app's own API returns (decided in the first version), and its codes are the app's.
- MCP resources and prompts.
- The `serverInfo` name.

## Acceptance

- `initialize` on the example shop returns instructions that start with the author's paragraph and name products, categories, customers and orders with their read, update and delete operations.
- With `introspection` off, `initialize` still returns the generated part.
- A test fails if any agent-facing text contains `Keystone`, `GraphQL`, `Prisma` or `keystone-mcp`, compared case-insensitively.
- `npm test` and `npm run build` pass.
