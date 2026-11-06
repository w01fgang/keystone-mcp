# Build

> Coordinator-maintained narrative board. TRACK, NEXT, PARKED and DROPPED are coordinator prose: keep them true in the change that moves feature state. NOW and PROVEN are generated from the feature lanes by `limen land`, `limen ticket done` and `limen board --write`; edit the tickets, not those lines.

TRACK at most three bullets. NEXT one clause per ticket. PROVEN names the last ten landed features, then one count line per month.

Status marks are prose only: 🟠 ACTIVE · 🔴 PLANNED · 🟢 PROVEN · ⚪ DROPPED. Nothing in `limen` treats them as workflow state.

## TRACK

- 🟢 `keystone-mcp` 0.1.0 works through a `file:` dependency (F001): `searchTool` and `callTool` on `POST /mcp`, with `searchTool` off in production unless `introspection: true`. Constraint stays: no change to `@keystone-6/core`; the mount uses `extendExpressApp` only.
- 🟠 Admins use `/mcp` from Claude Desktop by signing in with their browser (F002): OAuth on top of Keystone's own sign-in. Constraint: no OAuth state in Keystone lists; Keystone access control stays the only authority.
- **Standing models (owner, 2026-11-06):** OMP at `high` for every role; Pi is not installed on this seat. Complex work uses Opus 5.5 (`--engine omp --provider anthropic --model claude-opus-5-5 --thinking high`): the coordinator, feature slices, repairs that need design, reviews, research and judges. Simple work uses Sonnet 5.5 (`--engine omp --provider anthropic --model claude-sonnet-5-5 --thinking high`): scouts, spec keepers, picture refreshes, quality passes, finish resumes and mechanical repairs. When unsure, use Opus. Pass all four flags explicitly. Do not substitute another model when the route fails.

## NOW

<!-- Generated from spec/features/active/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F002-keystone-admins-connect-claude-desktop-to-mcp-by-signing-in-with-their-browser` (🟠 ACTIVE): Keystone admins connect Claude Desktop to /mcp by signing in with their browser

## NEXT

- No planned ticket. Publishing to npm waits for an explicit request.

## PROVEN

<!-- Generated from spec/features/done/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F001-keystone-apps-answer-mcp-clients-with-searchtool-and-calltool` (🟢 PROVEN): Keystone apps answer MCP clients with searchTool and callTool; landed 2026-11-06
- 2026-11: 1 landed. spec/features/done/2026-11/
