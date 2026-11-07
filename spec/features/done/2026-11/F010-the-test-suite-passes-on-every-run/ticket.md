---
opened: 2026-11-07
landed: 2026-11-07
---

# F010 · The test suite passes on every run

## Outcome

`npx vitest run` passes every time on an unchanged tree. Today about one full run in ten fails, on a different test in `test/auth.test.ts` each time. The same rate shows on the code before the `secret` option landed, so the cause is older. A flaky suite hides real failures from every worker and reviewer.

## Scope

- Find the cause with evidence before you change anything: a saved log of failing runs, and a run that shows the cause. The worker who saw it guessed that ports are reused across test workers; that guess is not checked.
- Fix the cause in the tests, or in `src/` if the flake is a real defect of the package.
- Start at the server setup and teardown in `test/auth.test.ts` (`servers`, `listen(0)`, `afterEach`).

## Out of scope

- Retries, longer timeouts or `--sequence` changes that hide the failure without a found cause.
- New tests for behavior the suite already covers.

## Acceptance

- The outcome names the cause and the run that showed it.
- 50 full runs of `npx vitest run` in a row pass, with the loop and its result saved to a file.
- The test count stays at 138 or more, and no test is skipped.

## Notes

- If the cause is a defect in `src/`, say what a user of the package would have seen.
