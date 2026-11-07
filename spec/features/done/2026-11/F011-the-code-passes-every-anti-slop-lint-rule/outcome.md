# Outcome

`npm run lint` (the vendored anti-slop Oxlint plugin, every rule at `error`, warnings denied) passes with no suppression, and the release workflow runs it before the tests on every push to `master`. Landed in `0c1da11` (candidate `777d82f`); the spacing autofix landed before it in `70e5e8a`.

Untrusted input is parsed once where it enters: `callTool` arguments by a non-recursive walk in `src/call.ts` that keeps every own key, the sign-in form and registration in `src/auth.ts`, and sealed values by one schema per kind. A sealed value that fails its schema reads as an unknown key, so a schema that drifts from `Values` breaks sign-in loudly in `test/auth.test.ts`.

Review 1 (PASS, `review-1.md`) found two behavior changes, both repaired with regression tests in `test/server.test.ts`: deep nesting overflowed the argument parse, and a nested `__proto__` key was dropped, which widened a filter. Two changes were accepted: an `extensions.code` such as `toString` now maps to `SERVER_ERROR`, and the client registration response lists its keys in another order. Real graphql-js coercion overflows near 640 nested levels with or without this change; that limit is graphql-js's, not ours.
