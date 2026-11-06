# F002 notes

Findings from `@keystone-6/core` 6.5.3, `@keystone-6/auth` 8.1.0 (scratch app at `/tmp/keystone-mcp-oauth-smoke`) and `@modelcontextprotocol/sdk` 1.32.2. `jg` returned no files for the Keystone `dist` and `src` questions about sessions; it found the sign-in page. The rest was read directly.

## Admin UI sign-in cannot carry the authorize step

- The Admin UI sign-in page always goes to `/` after sign-in: `useRedirect()` in `@keystone-6/auth/src/lib/useFromRedirect.ts` returns `'/'` ("TODO: remove or fix"). There is no `from` parameter, so it cannot return the browser to `/authorize`.
- The session cookie name is an option of `statelessSessions` (`cookieName`), so the package cannot read the raw session token from the cookie reliably.
- Decision: the fallback. The package serves its own sign-in and consent page. It runs the app's `authenticate<List>WithPassword` mutation, found in the GraphQL schema, through `context.withRequest(req, res)`.

## Keystone session facts the design uses

- `statelessSessions.get` takes the token from `Authorization: Bearer <token>` first, then from the cookie (`@keystone-6/core/src/session.ts`). A bad token gives no session; it does not fall back to the cookie.
- `statelessSessions.start` returns the sealed token only when `context.res` exists, and then also writes `Set-Cookie` to that response. The sign-in step passes a throwaway `ServerResponse`, so the browser gets no Admin UI cookie, and reads `sessionToken` from the mutation result.
- The sealed token has a TTL of the session `maxAge` (default 8 hours). The OAuth grant cannot outlive it: refresh and every MCP request check that `withRequest` gives a session, else `invalid_grant` / `401`.
- `withAuth` resolves `sessionData` on each `get`, so a deleted user has no session.

## SDK `server/auth`

- `mcpAuthRouter` needs a static issuer URL at construction and mounts `/authorize`, `/token`, `/register`, `/revoke` at the app root. Keystone gives `extendExpressApp` no public URL, so the package does not use the router.
- The package uses the SDK handlers one by one: `authorizationHandler` (S256 only, `redirectUriMatches`: exact match, port ignored only for loopback hosts), `tokenHandler` (PKCE check with `challengeForAuthorizationCode`, form-urlencoded body, `invalid_grant` errors), `clientRegistrationHandler` (DCR), `revocationHandler`, and `requireBearerAuth` (401 with `resource_metadata`, `expectedResource` check). Each handler has `express-rate-limit` per IP by default; the package keeps the defaults.
- `OAuthServerProvider` is the seam: an in-memory provider in `src/auth.ts` owns clients, pending sign-ins, codes, access tokens and refresh tokens.

## Design decisions

- Issuer and resource come from each request: `req.protocol` and the `Host` header. Behind a TLS proxy or tunnel the app must set Express `trust proxy`. No new option.
- Issuer is the origin. Metadata: `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource<path>` and `/.well-known/oauth-protected-resource`. Endpoints live under `<path>/oauth/` so they do not take app routes such as `/token`.
- An access token maps to the Keystone session token on the server. The MCP handler replaces the `Authorization` header with `Bearer <session token>` before `withRequest`, so Keystone access control stays the only authority. The Keystone token never leaves the server.
- State is in memory: one process, and a restart means each user signs in again. A Keystone list for OAuth state is out of scope.
- Every `POST <path>` needs a token. An app without a password `authenticate…WithPassword` mutation fails at mount with a message.
- Registered redirect URIs must be `https:` or loopback `http:`.
- The consent page names the client, shows the redirect host, warns when it is a loopback host, and sends `X-Frame-Options: DENY` and `Cache-Control: no-store`.
