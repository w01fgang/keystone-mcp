# Outcome

A Keystone 6 app that passes `keystoneMcp()` to `server.extendExpressApp` now answers `POST /mcp` with `searchTool` and `callTool`. `callTool` runs as the session of the request, and a live probe showed the same rows, fields and errors as `/api/graphql`. Merges: `6cb6c3f` (package and review fixes) and `c3122e5` (introspection default).

`searchTool` follows Apollo's introspection default: off when `NODE_ENV=production` unless the author passes `introspection: true`. Keystone does not pass its config to `extendExpressApp`, so the package cannot read the app's own Apollo setting; the author sets both.

`callTool` errors copy the steps of Keystone's `/api/graphql` error formatter (`formatGraphQLError` in `src/server.ts`), because Keystone does not export it. A Keystone upgrade that changes that formatter needs the copy updated. Nested list paths have no `/mcp` row limit; Keystone's per-list `maxTake` still applies.
