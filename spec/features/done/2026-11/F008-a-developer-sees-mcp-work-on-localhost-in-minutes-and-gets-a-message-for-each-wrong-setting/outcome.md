# Outcome

An app author can now connect MCP Inspector or Claude Code to `http://localhost:3000/mcp` with no tunnel, and the README leads with that local test and a deploy checklist. The server logs one line per mount (path, operation count, search on or off with the fix, sign-in mutation) and warns once when a proxy forwards `https` but Express does not trust it. OAuth clients and tokens now survive a `keystone dev` rebuild. Package commit `eee1813`, closed in `f7f0fe7`.

Proof: MCP Inspector signed in as a seed customer and read the products (screenshots in the job's artifacts). The coordinator ran 116 of 116 tests and the build at `eee1813`, and in a live shop signed in a scripted client, edited `schema.ts`, saw the second mount line, and called again with the same token and no new sign-in. Only a person ran the Claude Code steps "Authenticate" and "ask for the products".

The stores live in a module-level map keyed by path, because a dev rebuild keeps the package module loaded and calls `extendExpressApp` again. Keystone sessions still need a fixed `SESSION_SECRET` to survive a rebuild; the README says so. A process restart still signs everyone out; that is the planned `secret` option.
