# F006 outcome

The test suite now runs `searchTool` and `callTool` against a real Keystone 8.3.0 app with SQLite (`test/keystone/keystone.ts`, `test/fields.test.ts`). It covers every field type Keystone ships except `decimal`, plus `document` and `cloudinaryImage`. Landed in `4b86263`. The tests found no package defect, and `src/` did not change.

`decimal` is not tested because Keystone does not support it on SQLite; `notes.md` gives the reason and the known catalog limits. A test against a Keystone app must keep the `graphql` alias in `vitest.config.ts`, or Vite loads a second copy of graphql. When `callTool` was changed to run as `sudo`, the access test failed, so the test catches that fault.
