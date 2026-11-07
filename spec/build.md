# Build

> Coordinator-maintained narrative board. TRACK, NEXT, PARKED and DROPPED are coordinator prose: keep them true in the change that moves feature state. NOW and PROVEN are generated from the feature lanes by `limen land`, `limen ticket done` and `limen board --write`; edit the tickets, not those lines.

TRACK at most three bullets. NEXT one clause per ticket. PROVEN names the last ten landed features, then one count line per month.

Status marks are prose only: 🟠 ACTIVE · 🔴 PLANNED · 🟢 PROVEN · ⚪ DROPPED. Nothing in `limen` treats them as workflow state.

## TRACK

- 🟢 `keystone-mcp` 0.1.2 is on npm as `latest` (2026-11-07): zod 4 (advisory GHSA-mrhx-c7xc-m3w5) and at most 500 `select` paths. Public GitHub repository `w01fgang/keystone-mcp`, MIT. Constraint stays: no change to `@keystone-6/core`; the mount uses `extendExpressApp` only.
- 🟢 Admins use `/mcp` from Claude Desktop by signing in with their browser (F002); the owner confirmed it in Claude Desktop on 2026-11-07.
- **Standing models (owner, 2026-11-06):** OMP at `high` for every role; Pi is not installed on this seat. Complex work uses Opus 5.5 (`--engine omp --provider anthropic --model claude-opus-5-5 --thinking high`): the coordinator, feature slices, repairs that need design, reviews, research and judges. Simple work uses Sonnet 5.5 (`--engine omp --provider anthropic --model claude-sonnet-5-5 --thinking high`): scouts, spec keepers, picture refreshes, quality passes, finish resumes and mechanical repairs. When unsure, use Opus. Pass all four flags explicitly. Do not substitute another model when the route fails.

## NOW

<!-- Generated from spec/features/active/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F010-the-test-suite-passes-on-every-run` (🟠 ACTIVE): The test suite passes on every run

## NEXT

- Nothing planned.

## PROVEN

<!-- Generated from spec/features/done/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F009-sign-ins-survive-a-restart-and-work-across-several-processes` (🟢 PROVEN): Sign-ins survive a restart and work across several processes; landed 2026-11-07
- `F008-a-developer-sees-mcp-work-on-localhost-in-minutes-and-gets-a-message-for-each-wrong-setting` (🟢 PROVEN): A developer sees /mcp work on localhost in minutes and gets a message for each wrong setting; landed 2026-11-07
- `F007-the-shop-example-runs-on-current-keystone-with-no-known-vulnerabilities` (🟢 PROVEN): The shop example runs on current Keystone with no known vulnerabilities; landed 2026-11-07
- `F006-every-keystone-field-type-works-through-searchtool-and-calltool` (🟢 PROVEN): Every Keystone field type works through searchTool and callTool; landed 2026-11-07
- `F005-error-text-from-mcp-names-no-technology` (🟢 PROVEN): Error text from /mcp names no technology; landed 2026-11-07
- `F004-agents-learn-what-the-project-is-when-they-connect-to-mcp` (🟢 PROVEN): Agents learn what the project is when they connect to /mcp; landed 2026-11-07
- `F003-the-repository-has-a-small-shop-example-that-shows-how-to-use-the-package` (🟢 PROVEN): The repository has a small shop example that shows how to use the package; landed 2026-11-07
- `F002-keystone-admins-connect-claude-desktop-to-mcp-by-signing-in-with-their-browser` (🟢 PROVEN): Keystone admins connect Claude Desktop to /mcp by signing in with their browser; landed 2026-11-07
- `F001-keystone-apps-answer-mcp-clients-with-searchtool-and-calltool` (🟢 PROVEN): Keystone apps answer MCP clients with searchTool and callTool; landed 2026-11-06
- 2026-11: 9 landed. spec/features/done/2026-11/
