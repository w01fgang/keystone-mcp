PASS 04897c121ba7568b5fe22eacb017bf467b158dae

I reviewed commit `04897c121ba7568b5fe22eacb017bf467b158dae`. `git rev-parse HEAD` matches it, and the tree is clean. I found no blocking finding.

## Blocking findings
None.

## Unverified checks
- **Live test in Claude Desktop through a public HTTPS tunnel.** Not run. The ticket's Notes give this test to the owner. Every flow below ran against `http://localhost`.
- **Behavior behind a proxy or tunnel that rewrites `Host`.** Unverified. The issuer and resource URLs come from `req.protocol` and the raw `Host` header (`origin()` in `src/auth.ts`). If a tunnel rewrites `Host` to the local address, the metadata `resource` will not match the URL the user typed. Claude requires an exact match, so connect then fails. cloudflared and ngrok keep the public `Host` by default.

## Acceptance, per bullet
I made a fresh copy of the scratch app on port 3124 with an empty DB. Its installed `keystone-mcp` `dist` is byte-identical to the HEAD build. I ran the worker's `smoke.mjs` against it once, and every check passed. The log is `review-smoke.log` in this review job's folder.
1. **401 with `resource_metadata`; both metadata documents name S256.** PASS.
2. **Admin sign-in flow; `updatePost` and `deletePost` succeed.** PASS.
3. **A non-admin gets `KS_ACCESS_DENIED`.** PASS.
4. **Refresh rotates; the old refresh token gets `invalid_grant`.** PASS. Three parallel refreshes of one token returned `[200,400,400]`.
5. **`initialize` returns `instructions`.** PASS.
6. **The README gives step-by-step Claude Desktop setup.** PASS. The "Connect Claude Desktop" section has 7 steps, with the tunnel and `trust proxy` example.

## Who can act as whom
All results below are proven by `review-probe.mjs` against live Keystone 6.5.3.
- **No path runs `callTool` as another user.**
  - An editor access token sent with an admin Admin UI cookie: `updatePost` returned `KS_ACCESS_DENIED`.
  - A raw Keystone session token as the bearer on `/mcp`: `401`.
  - An admin cookie with no bearer on `/mcp`: `401`.
- **An access token works only with the `Host` it was issued for.** The editor token sent with `Host: evil.example` got `401`.
- **Codes are single-use and bound to one client.**
  - Client A's code redeemed by client B: `invalid_grant`.
  - Three parallel exchanges of one code: `[200,400,400]`.
  - A sign-in transaction replayed after success: `400`.
- **Refresh tokens are bound to one client.**
  - Client A's refresh token used by client B: `invalid_grant`.
  - A revoke sent by client B left client A's access token valid, which is correct.
- **The consent page cannot be framed.** It sends `X-Frame-Options: DENY` and a CSP with `frame-ancestors 'none'`.
- **A foreign `resource` is refused.** Authorize redirects with `invalid_target`.
- **Consent-page CSRF has no cross-user effect.** The transaction id is random, and each sign-in needs the password. A forced form post can only send a code for the attacker's own account to the attacker's own redirect URI.

## Notes (none blocking)
1. **Proven by a throwaway vitest probe, since deleted: a sign-in request hangs when the password mutation throws.** The sign-in POST handler in `src/auth.ts` is async and has no try/catch, and Express 4 does not catch a rejected async handler. In the probe the request got no response, and the rejection was unhandled. Under Node's default setting this would crash the process [INFERENCE]. Hostile input did not trigger it on the live app: 90 KB identity, 90 KB secret and NUL input all returned `401`. A backend failure, such as a database outage, is the realistic trigger. The fix is a try/catch that answers `500`, as the `/mcp` handler does.
2. **Proven: a client registered through DCR can make the authorize endpoint redirect to any https host.** An authorize request with no PKCE returned `302` to `https://evil.example/cb?error=…` with no user interaction. The SDK's `authorizationHandler` does this, and it matches RFC 9700 §4.11. A DCR client can also choose any `client_name` and any https redirect. The consent page shows the redirect host, which is the mitigation the contract asks for.
3. **Proven: the metadata documents reflect any `Host` header.** With `Host: evil.example`, `authorization_endpoint` became `http://evil.example/...`. The response has no `Cache-Control` and no `Vary` header. This matters only behind a shared cache that does not key on `Host`.
4. **Plausible: an attacker can evict live clients.** The clients store and the pending sign-ins store drop their oldest entries above 1000. Registration allows 20 per hour per IP, so an attacker with about 50 IPs can evict every live client in an hour. An evicted client's next refresh gets `invalid_client`, not `invalid_grant`.
5. **Plausible: the sign-in form has no rate limit of its own.** One IP can try about 500 passwords per 15 minutes: 5 attempts per transaction, 100 transactions per 15 minutes. `/api/graphql` already allows unlimited password attempts, so this adds no new exposure.
6. **Hardening, not acceptance.** Reuse of a code does not revoke the tokens that code issued. Reuse of a refresh token does not revoke the tokens issued after it.
7. **Known limit, documented in the README.** The grant ends with the Keystone session. With the default `maxAge` of 8 hours, an admin must sign in again at least every 8 hours.

## Checks run
- `npm ci`, `npm test` and `npm run build` in one call. Result: 59 of 59 tests passed, and the build succeeded. I piped the output through `tail` and joined the commands with `;`, and I saved no log.
- Smoke-build identity: `diff -r` showed the scratch app tgz `dist` matches the HEAD build.
- The worker's `smoke.mjs` against live Keystone on port 3124: every check passed (`review-smoke.log`).
- `node probe.mjs` against the same app: the results listed above.
- A throwaway vitest probe of a failing password mutation: no response and an unhandled rejection. I deleted the test file afterwards.
- `probe2.mjs` with hostile sign-in input: `401`, `401`, `401`.
- `git rev-parse HEAD && git status --short`: printed the candidate sha with no changes.

## Note check
- HEAD is 04897c1 and the tree is clean: proven. `git rev-parse HEAD && git status --short`
- Acceptance bullet 1, 401 with `resource_metadata` and metadata naming S256: proven. `/Users/wolf/sources/keystone-mcp/.limen/jobs/2026-11-06-f002-admins-sign-in-to-mcp-revie-022bef60/review-smoke.log`
- Acceptance bullet 2, scripted admin flow with `updatePost` and `deletePost`: proven. `/Users/wolf/sources/keystone-mcp/.limen/jobs/2026-11-06-f002-admins-sign-in-to-mcp-revie-022bef60/review-smoke.log`
- Acceptance bullet 3, non-admin gets `KS_ACCESS_DENIED`: proven. `/Users/wolf/sources/keystone-mcp/.limen/jobs/2026-11-06-f002-admins-sign-in-to-mcp-revie-022bef60/review-smoke.log`
- Acceptance bullet 4, refresh rotation and old token `invalid_grant`: proven. `/Users/wolf/sources/keystone-mcp/.limen/jobs/2026-11-06-f002-admins-sign-in-to-mcp-revie-022bef60/review-smoke.log`
- Acceptance bullet 5, `initialize` returns `instructions`: proven. `/Users/wolf/sources/keystone-mcp/.limen/jobs/2026-11-06-f002-admins-sign-in-to-mcp-revie-022bef60/review-smoke.log`
- Acceptance bullet 6, README Claude Desktop steps: proven. `README.md`
- Impersonation risks prosecuted: proven. `node probe.mjs` (run from the deleted `/tmp/f002-review-app`); a copy of the script is `/Users/wolf/sources/keystone-mcp/.limen/jobs/2026-11-06-f002-admins-sign-in-to-mcp-revie-022bef60/review-probe.mjs`. Proof for note 1, the hanging sign-in, came from a piped vitest call and has no saved log.
- Native suite run once on this tree: not proven. My run joined its commands with `;` and piped them through `tail`, and I saved no log. The coordinator's log at the same commit, `/tmp/f002-lane-04897c1.log`, comes from the worker's worktree, not this one. I did not repeat this run-once check.
- Easy-to-miss rule, "Blocking is only a proven break of an acceptance bullet. PLAUSIBLE is never blocking.": followed. No finding is blocking, every note carries a label, and the plausible items are notes 4 and 5 only.
