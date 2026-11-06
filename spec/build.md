# Build

> Coordinator-maintained narrative board. TRACK, NEXT, PARKED and DROPPED are coordinator prose: keep them true in the change that moves feature state. NOW and PROVEN are generated from the feature lanes by `limen land`, `limen ticket done` and `limen board --write`; edit the tickets, not those lines.

TRACK at most three bullets. NEXT one clause per ticket. PROVEN names the last ten landed features, then one count line per month.

Status marks are prose only: 🟠 ACTIVE · 🔴 PLANNED · 🟢 PROVEN · ⚪ DROPPED. Nothing in `limen` treats them as workflow state.

## TRACK

- 🟠 Ship `keystone-mcp` 0.1.0 (F001): a Keystone app mounts `searchTool` and `callTool` on `POST /mcp`, so MCP clients query the app through its GraphQL schema. Constraint: no change to `@keystone-6/core`; the mount uses `extendExpressApp` only.

## NOW

<!-- Generated from spec/features/active/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F001-keystone-apps-answer-mcp-clients-with-searchtool-and-calltool` (🟠 ACTIVE): Keystone apps answer MCP clients with searchTool and callTool

## NEXT

- No planned ticket. Publishing to npm waits for an explicit request.

## PROVEN

<!-- Generated from spec/features/done/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->
