---
touches:
  - keystone-mcp.mount
  - keystone-mcp.server
opened: 2026-11-06
---

# F002 · Keystone admins connect Claude Desktop to /mcp by signing in with their browser

## Outcome

A Keystone admin who uses only a web browser and Claude Desktop adds the app's `/mcp` URL as a custom connector, signs in with their usual Keystone email and password in the browser, and then asks Claude to read, update and delete records. Claude acts as that admin, so Keystone access control decides what it can do. Today the admin must call `/api/graphql` by hand to get a bearer token, which this user cannot do.

## Scope

- `/mcp` becomes an OAuth 2.1 protected resource that Claude's connector client accepts: an unauthenticated `POST` gets `401` with a `resource_metadata` pointer, and the package serves protected-resource and authorization-server metadata, DCR, S256 PKCE, and refresh-token rotation. Contract: https://claude.com/docs/connectors/building/authentication
- Sign-in uses the app's own Keystone authentication (`@keystone-6/auth`), not a new user store. Reusing the Admin UI sign-in and its session cookie is the lead to check first; a package sign-in page that calls Keystone's password check is the fallback.
- An access token makes `callTool` run as the signed-in user through the existing `withRequest` path, so Keystone sessions and access rules stay the only authority.
- The hosted Claude redirect `https://claude.ai/api/mcp/auth_callback` and port-agnostic loopback redirects are accepted.
- The MCP `initialize` response carries short `instructions` for the client: search first, then call; how to read, update and delete one record by `where: { id }`.
- Starting seam: `src/mount.ts`; a new `src/auth.ts` owns the OAuth routes. Check what `@modelcontextprotocol/sdk` 1.32.2 offers under `server/auth` before writing routes by hand.

## Out of scope

- A Keystone list or database table for OAuth state.
- Static header or API-key auth.
- Publishing to npm, or a listing in the Claude connector directory.

## Acceptance

- An unauthenticated `POST /mcp` responds `401` with `WWW-Authenticate: Bearer resource_metadata="…"`, and both metadata documents are served and name `S256`.
- A scripted OAuth client (DCR, browser sign-in simulated with the admin's email and password, code exchange) gets an access token, and `callTool` `updatePost` and `deletePost` succeed with it in the scratch app.
- The same flow signed in as a non-admin user gets `KS_ACCESS_DENIED` for an action the app's access rules deny.
- A refresh returns a new refresh token, and the old one then gets `invalid_grant`.
- `initialize` returns the `instructions` text.
- The README tells an admin, step by step, how to add the connector in Claude Desktop.

## Notes

- Claude connects from Anthropic's cloud (`160.79.104.0/21`), so the app must be reachable over public HTTPS. A local app needs a tunnel for the owner's live test in Claude Desktop.
- Live proof uses a scratch Keystone 6 app at `/tmp/keystone-mcp-oauth-smoke`, outside Git. Delete it after the feature closes.
