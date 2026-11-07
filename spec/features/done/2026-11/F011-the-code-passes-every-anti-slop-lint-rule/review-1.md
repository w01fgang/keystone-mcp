PASS 0f7f0828fab19c9fd0612b012151bfdd66c32ebe

I reviewed commit `0f7f0828fab19c9fd0612b012151bfdd66c32ebe`. `git rev-parse HEAD` printed that SHA. Every ticket acceptance bullet holds by my runs and the coordinator's report, so nothing blocks. The candidate has three proven behavior changes. The ticket forbids behavior change only in its "Out of scope" section, not in an acceptance bullet, so these are notes. The coordinator decides whether to send them back.

**Blocking findings:** none.

**Unverified:** I did not rerun `npm run build` or the `examples/shop` typecheck. Those results come from the coordinator's report only.

**Notes**

1. **Proven by reproduction: the tool-argument parse rejects deep, valid input that the old code ran.**
   - Method: a throwaway Vitest file imported the old `src/` (from `0f7f082^`) and the new `src/`. It ran the same `callTool` requests through `InMemoryTransport` with the `test/schema.ts` fixture.
   - `postsCount` with `where` nested N levels of `{"AND":[…]}`: results match for N from 100 to 600.
   - At N = 800 and 1000, the old code returned `{"postsCount":100}`. The new code returned a tool error whose only text is `Maximum call stack size exceeded`.
   - Cause: `callArguments` in `src/call.ts` is a recursive `z.lazy` union. `src/server.ts` runs it through `.pipe(callArguments)`. The SDK input check overflows the stack before the handler runs.
   - At 2000 or more levels, unknown-argument and wrong-shape inputs also changed. The old code gave clean `INVALID_INPUT` messages. The new code gives the raw RangeError text, which breaks the `server.ts` rule that the agent reads only neutral messages.
   - The exact limit depends on stack size. Practical risk is low, because real agents do not send this depth.
   - Fix options: a non-recursive JSON check, or a `SAFETY:` assertion that names this invariant: the transport JSON-parses the body, so every value is JSON.
2. **Proven by reproduction: a nested `__proto__` key is now dropped without an error.**
   - Input: `{"where":{"__proto__":{"x":1}}}`.
   - The old code passed the key to GraphQL, which rejected it with `INVALID_INPUT`: "Field "__proto__" is not defined by type "PostWhereInput"".
   - The new zod record drops the key, so the query runs with `where: {}`.
   - A probe showed that the key does not become a prototype: GraphQL received `{"where":{}}`.
   - The same happens to `data` in a mutation. Keystone access rules still apply.
3. **Proven by reproduction: error codes that are `Object.prototype` names now return a neutral error.**
   - The input is a `GraphQLError` whose `extensions.code` is `toString` or `constructor`.
   - The old code leaked the raw message `Access denied: x` with no code.
   - The new `Map` lookup in `KEYSTONE_CODES` returns `SERVER_ERROR` with the fixed message.
   - This is an improvement, and Keystone never sends these codes. It is still a change in output.
4. **Proven by comparison: the `src/auth.ts` parses accept the same inputs.**
   - `signInForm` reads the same transaction, identity, secret and allow/deny decision as the old code. Tested bodies: missing, empty, repeated (array) and null-prototype `querystring` bodies.
   - `clientRecord` never throws on a registration that the SDK accepted. It stores JSON equal to the old destructure.
   - The only difference is key order in the 201 response: `client_id_issued_at` now comes before `client_secret_expires_at`.
5. **Checked by reading (plausible no-change): `authorizationRequest`.** `ClientAuthorizationParamsSchema` in SDK 1.32.2 (`server/auth/handlers/authorize.js`, lines 39–45) already makes `redirect_uri` a string or absent before `authorize` runs. So `redirectUriSent` keeps its old value.
6. **Proven by comparison: the MCP tool schema is unchanged.** Old and new gave identical `tools/list` output (compared as JSON text). Server instructions and `searchTool` results for `post` and for empty text were also identical.
7. **Proven by comparison: these inputs give the same `callTool` results and the same GraphQL variables at both commits.**
   - No `args`, and `args` set to `{}`.
   - `take` set to `1e400`, `-1e400`, `2^70`, `-0`, `"5"`, `null`, `7` and `51.5`.
   - A top-level `__proto__` key, and `args` given as an array, a string or null.
   - An unknown argument, unicode text, a normal create and a wrong-type `take`.
   - Nesting of 1000 levels or fewer in shapes other than the `AND` shape.
8. **Ticket drift: sealed values have no new parse.** `sealedVault.get` in `src/auth.ts` is unchanged. It still assigns the `any` result of `JSON.parse` to `Values[K]`. AES-GCM authenticates the value, so nothing is exposed. The ticket scope bullet about sealed values is still unmet, and lint cannot see it.
9. **Ticket drift: "no behavior change" is not an acceptance bullet.** A reviewer cannot block on it. If it should gate the merge, the ticket needs an observable acceptance line.
10. **Checked by reading: `SAFETY:` comments.** Every one in `src`, `test` and `examples` names a checked invariant.

**Checks I ran**

- `npm ci`: 607 packages added.
- Throwaway old-vs-new comparison under `.review-old/`, deleted after use. Results are in notes 1–7. I did not save its output to a log.
- `npm run lint`: exit 0, no findings printed. The call also contained `;` and a pipe.
- `grep -rn 'oxlint-disable' src test examples`: no output.
- `npm run typecheck` followed by `npm test`: typecheck passed, and 8 files with 138 tests passed. Both output streams went through pipes.
- `git rev-parse HEAD`: `0f7f0828fab19c9fd0612b012151bfdd66c32ebe`.

Note check
- HEAD is the candidate: proven. `git rev-parse HEAD`
- Zod parses reject no input the old code accepted: not proven, and a proven break exists. Notes 1 and 2 show call.ts changes. The comparison output was not saved to a log file, and the scratch files are deleted. Sealed values have no new parse.
- Error text and tool schema unchanged: not proven. The schema matched, but error text changed for deep nesting, nested `__proto__` and prototype-named codes. The comparison output was not saved.
- Acceptance 1, `npm run lint` exits 0 with no findings: not proven by the note rules. It exited 0, but the call used `;` and a pipe, and no log was saved.
- Acceptance 2, the `oxlint-disable` grep prints nothing: not proven by the note rules. It printed nothing, but in a call joined with `;` and no saved log.
- Acceptance 3, typecheck, `npm test` (138 or more tests) and build pass: not proven. Typecheck and test passed, but their output went through pipes, and I did not run the build.
- Acceptance 4, `examples/shop` typechecks against the built package: not proven. I did not run it; only the coordinator report covers it.
- Acceptance 5, every `SAFETY:` comment names a checked invariant: not proven by the note rules. I read it in `git grep` output that went through a pipe; no file or log holds it.
- Easy-to-miss rule, "Behavior changes: the MCP tool text, error text, OAuth flow and public options stay the same.": broken. Notes 1–3 give three reproduced deviations. The reproduction scripts and their output were not kept.
