---
opened: 2026-11-07
---

# F009 · Sign-ins survive a restart and work across several processes

## Outcome

A team that deploys the app, restarts it, or runs two processes behind a load balancer keeps its MCP clients signed in. Today the OAuth clients and tokens live in the memory of one process: a deploy signs every user out, and a second process rejects the tokens of the first. This is the first limit a real team meets in production.

## Scope

- A new option `secret` (at least 32 characters). With it, the registered client, the pending sign-in of the consent page, the authorization code, the access token and the refresh token are sealed values that any process with the same secret can open, so no server state is needed. Start at `storesOf` in `src/auth.ts`, where the memory stores now live for the life of the process.
- Without `secret`, the package keeps today's memory stores, and the mount line in the server log says that sign-ins end at restart.
- README: the option, the deploy checklist entry, and what a sealed grant cannot do.
- The vision's option list gains `secret` in the same change.

## Out of scope

- A pluggable store interface (Redis, database).
- Sign-in methods other than the password mutation.

## Acceptance

- Two app processes with the same `secret`: a client registers and opens the sign-in page through one, submits it through the other, then calls `/mcp` and refreshes through either.
- A client that signed in before a restart calls `/mcp` after it without a new sign-in.
- A token sealed with another secret, or changed by one byte, gets `401`.
- An expired access token gets `401`; when the Keystone session ends, refresh gets `invalid_grant`, as today.
- A `secret` shorter than 32 characters throws at start.

## Notes

- Cost of sealed values, accepted by the owner on 2026-11-07: a code can be used more than once within its 10-minute life (PKCE still binds it to the client), reuse of a rotated refresh token is not detected, and revoke cannot end a grant before the Keystone session ends. Keystone's own stateless sessions have the same limits.
- A grant carries the Keystone session token, so a sealed value is encrypted and authenticated, not only signed. A client must not read the session token from its own access token.
- Alternatives weighed: a store interface moves the work to every author; lists in the app's database would show in its schema and catalog.
