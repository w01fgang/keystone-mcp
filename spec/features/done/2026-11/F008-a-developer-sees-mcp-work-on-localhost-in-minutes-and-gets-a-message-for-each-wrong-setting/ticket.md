---
opened: 2026-11-07
landed: 2026-11-07
---

# F008 · A developer sees /mcp work on localhost in minutes and gets a message for each wrong setting

## Outcome

An app author who installs the package can connect a local MCP client to `http://localhost:3000/mcp` and run a call within minutes, with no tunnel. Today the README shows only Claude Desktop, which needs public HTTPS, a tunnel and `trust proxy` before the first call. A wrong setting now fails without a message; afterwards the server log names the problem and the fix. A schema edit in `keystone dev` no longer signs the author out.

## Scope

- README: a "try it locally" section for clients that connect from the author's machine (for example Claude Code, MCP Inspector, VS Code). Write down only the steps you ran.
- One log line when the endpoint mounts: the path, the number of operations, whether search is on (and, when it is off, the option that turns it on), and the sign-in mutation. Start at `keystoneMcp` in `src/mount.ts`.
- One warning, once per process, when a request arrives with `X-Forwarded-Proto: https` but Express reads it as `http`. It names `app.set('trust proxy', 1)`.
- OAuth clients and tokens survive a `keystone dev` rebuild. The stores are created in `mountOAuth` (`src/auth.ts`), which runs again on each rebuild.
- README order: what the users of the app get, wiring, local test, a deploy checklist (`SESSION_SECRET`, `trust proxy`, `introspection`, one process), then the reference. Document two levers that exist today: `graphql.omit` to hide a list or an operation, and `context.req` in hooks to tell an `/mcp` call from other calls.

## Out of scope

- Sign-ins that survive a process restart or work across processes (a separate ticket).
- New options in `keystoneMcp()`; the vision fixes five.
- Sign-in methods other than the password mutation.

## Acceptance

- The README's local steps, run as written against the shop example, end with a client that signed in as a seed customer and read the products with `callTool`.
- `npm run dev` in the shop example prints the mount line with the operation count and "search on".
- With `NODE_ENV=production`, the mount line says search is off and names `introspection: true`.
- A request with `X-Forwarded-Proto: https` to an app without `trust proxy` logs the warning once; with `trust proxy` it logs nothing.
- In the shop example, a client that signed in keeps working after a schema edit triggers a rebuild, with no new sign-in.
- The `context.req` claim in the README is checked by a test or a live call.

## Notes

- Keystone checkout, read only: `../keystone` (8.3.0). Rebuild logic: `packages/core/src/scripts/dev.ts`. Search with `jg "<question>" ../keystone`.
- If a rebuild re-evaluates the package module, so that the stores cannot survive without a global, say so in the outcome and choose the least surprising holder.
- The log text is for the developer, so it may name Keystone and GraphQL. Text the agent reads still may not.
- A worker cannot sign in through a browser. Prove the local flow with a scripted client that does the same OAuth steps (`test/oauth.ts` has the pieces), and say in the outcome which README step only a person ran.
