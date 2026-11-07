---
opened: 2026-11-07
touches:
  - keystone-mcp
  - keystone-mcp.call
  - keystone-mcp.server
  - keystone-mcp.mount
  - keystone-mcp.catalog
---

# F011 · The code passes every anti-slop lint rule

## Outcome

`npm run lint` passes with no errors and no warnings. CI runs it on every push to `master` before the tests, so a release cannot ship code that breaks a rule. The owner asked for every finding to be fixed, not hidden.

## Scope

- Fix the 76 findings that `npm run lint` reports in `src/`, `test/`, `test/keystone/` and `examples/shop/`. The spacing rule is already fixed.
- Untrusted input (MCP tool arguments, HTTP bodies, JSON, sealed values, caught errors) is parsed once at its boundary into a named type. Code after the boundary takes that type, not `unknown`.
- A type assertion that stays gets a `SAFETY:` comment that states the invariant that makes it true.
- Start at `src/call.ts` and `src/types.ts`: the variables and result dictionaries there decide the types that `server.ts` and the tests consume.

## Out of scope

- Changes to the rules, their severity, `.oxlintrc.json` ignores, or the vendored plugin in `tools/oxlint/anti-slop/`.
- `oxlint-disable` comments and casts added only to silence a rule.
- Behavior changes: the MCP tool text, error text, OAuth flow and public options stay the same.

## Acceptance

- `npm run lint` exits 0 and prints no findings.
- `grep -rn 'oxlint-disable' src test examples` prints nothing.
- `npm run typecheck`, `npm test` (138 tests or more) and `npm run build` pass.
- The public types in `dist/index.d.ts` accept the same app configuration as before: `examples/shop` typechecks against the built package.
- Every `SAFETY:` comment names a checked invariant, not "trusted" or "known".

## Notes

- `src/types.ts` mirrors the Keystone context (`graphql.run`). A narrower type there must still accept a real Keystone context; `test/keystone/keystone.ts` is the proof.
