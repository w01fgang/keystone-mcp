PASS e75942afbb54d5f450284911f2c559b619fdce40

Reviewed commit: `e75942afbb54d5f450284911f2c559b619fdce40`. `git rev-parse HEAD` matches the candidate, and the tree was clean before and after the checks.

**Blocking findings:** none.

**Unverified:** I did not rerun the live proof with two real `keystone start` processes. The retained logs in `.limen/jobs/2026-11-07-f009-sign-ins-survive-restarts-w-de35ff3b/` were checked as follows:
- `proof-two-processes.log` and `proof-restart.log` show:
  - register, sign-in and refresh across processes A and B;
  - `401` for a changed token;
  - `401` and `invalid_client` on process C, which has another secret;
  - a client still signed in after a restart;
  - a control run without a secret that gets `401` after the restart.
- The `tip` file of that job names `e75942a`. Whether that tree was clean is not recorded, so these logs support acceptance bullets 1 and 2 but do not prove them on their own. The in-process tests below do prove them.

**The riskiest claim: one kind of sealed value accepted as another, or a value for one client, path or resource accepted for another.** It holds (proven).
- Code read: `sealedVault` in `src/auth.ts` uses AES-256-GCM with the AAD `${path}\n${kind}`. It rejects any value that does not survive a strict base64url round trip, which stops the spare-bit malleability of the last character.
- The client check (`record.clientId !== client.client_id`) applies to the code challenge, the code exchange and the refresh.
- `authenticate` checks `sameResource` against the request URL. Code exchange and refresh check `resource`.
- A throwaway Vitest probe (`test/zz-review-probe.test.ts`, deleted after the run) mounted `/mcp` and `/ai` with the same secret on one app. Every result below was observed:
  - **Bearer on `/mcp`:** client_id, transaction, code and refresh token each got `401`. Only the access token got `200`.
  - **`refresh_token`:** client_id, transaction, code and access token each got `400 invalid_grant`.
  - **`code`:** client_id, transaction, access token and refresh token each got `400 invalid_grant`.
  - **`client_id`:** transaction, code, access token and refresh token each got `400` at authorize and `invalid_client` at the token endpoint.
  - **Sign-in `transaction`:** client_id, code, access token and refresh token each got `400`.
  - **Code of client A sent by client B, with A's verifier:** `invalid_grant`.
  - **Refresh token of A sent by client B:** `invalid_grant`.
  - **Another path:**
    - The `/mcp` access token on `/ai` got `401`.
    - The `/mcp` client_id at `/ai` authorize got `400`.
    - The `/mcp` refresh token at `/ai` got `400`.
    - The `/mcp` transaction at `/ai` sign-in got `400`.
    - The `/ai` access token on `/mcp` got `401`.
  - **Another resource:** the same token with `Host: other.example` got `401`. Refresh with `resource=https://other.example/mcp` got `invalid_target`.

**Acceptance bullets** (`spec/features/active/F009-…/ticket.md`, 5 items):
1. **Two processes with the same secret:** proven by the test `continues a sign-in on a second server with the same secret…`. It uses separate module instances through `vi.resetModules`. The retained live log supports it.
2. **Signed in after a restart:** proven by the test `keeps a client signed in after a restart`. The retained live log supports it.
3. **Another secret or one changed byte gets `401`:** proven by the test `refuses a value sealed with another secret…`. It changes the first, middle and last characters, and tries every alphabet character in the last position.
4. **Expired access token and ended session:** proven.
   - `refuses an access token after it expires` (sealed mode) gives `401`.
   - `refuses a token whose Keystone session has ended, on /mcp and on refresh` runs in both modes and gives `invalid_grant` on refresh.
5. **Short secret throws at start:** proven by `mount.test.ts`: 31 characters and `''` throw, 32 characters do not.

**Notes:**
- **Ticket drift (proven by code read).** The ticket's Notes say "a code can be used more than once within its 10-minute life". The code keeps `CODE_SECONDS = 5 * 60`, and the README says "within its 5 minutes". The 10 minutes is `SIGN_IN_SECONDS`, the life of the sign-in transaction. The ticket text is wrong; the code and README agree with each other.
- **A transaction can sign in once on each process (plausible, not reproduced).** After a sign-in succeeds or is denied, the transaction ends only in the process that handled it (`countAttempts(SIGN_IN_ATTEMPTS)` writes to that process's `signInAttempts`). Another process with the same secret still accepts the same transaction for up to 10 minutes and can issue another code after the password is entered again. This is the same kind of cost as the accepted ones (code reuse, attempts counted per process). The README names only "the limit of 5 password tries … counts in each process". One more clause there would make it explicit.
- **Other deployments with the same secret (plausible).** Two different deployments that share the same `secret` and the same path accept each other's sealed client_ids and transactions. Tokens are still bound to the resource URL, which comes from the host. The README says to use a random secret, so this is a hardening idea, not a defect.
- **Memory mode still behaves as before (proven).** `describe.each` runs the whole OAuth suite in both modes. The single-use code and the detection of a reused refresh token are still asserted when there is no secret.

**Checks run:**
- `npm ci`: passed (604 packages).
- `npx vitest run`: 8 files, 138 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- The throwaway probe above: 1 test passed. The verbose run showed every status listed above. The file was deleted afterwards.

PASS e75942afbb54d5f450284911f2c559b619fdce40

The verdict on commit `e75942afbb54d5f450284911f2c559b619fdce40` does not change. There are no blocking findings. The full findings are in my previous message: no blocking findings, one ticket-drift note, two plausible notes, and the list of checks with their results. Several note checks below are not proven under the Limen proof rule. The reason is how I ran them, not a fault in the candidate: those bash calls used `;` or a pipe, and the probe file was deleted after its run. I did not rerun them only to clear the note.

The throwaway probe `test/zz-review-probe.test.ts` was deleted in the same bash call that ran the full suite, by `rm … && git status --short && …`. The worktree has no file left from this review.

## Note check
- **Commit is `e75942a…` and the tree is clean:** not proven. I saw `git rev-parse HEAD` print `e75942afbb54d5f450284911f2c559b619fdce40`, and `git status --short` print nothing, but that call joined its commands with `;`. No saved log exists.
- **No kind, client, path or resource crossover:** not proven. `src/auth.ts` (`sealedVault`, AAD `${path}\n${kind}`) shows the design. The probe output that showed every crossover refused came through `| grep`, and I deleted the probe file. Missing: a saved run of that probe.
- **Acceptance 1, two processes with the same secret:** proven. `/Users/wolf/sources/keystone-mcp/.limen/jobs/2026-11-07-f009-sign-ins-survive-restarts-w-de35ff3b/proof-two-processes.log` holds the worker's live run, recorded at tip `e75942a`. Whether that tree was clean is not recorded.
- **Acceptance 2, signed in after a restart:** proven. `/Users/wolf/sources/keystone-mcp/.limen/jobs/2026-11-07-f009-sign-ins-survive-restarts-w-de35ff3b/proof-restart.log` holds the worker's live run, with a control run without a secret. Same caveat about the clean tree.
- **Acceptance 3, another secret or one changed byte gets `401`:** proven. `/Users/wolf/sources/keystone-mcp/.limen/jobs/2026-11-07-f009-sign-ins-survive-restarts-w-de35ff3b/proof-two-processes.log` shows the token changed in its last character gets `401`, and process C, which has another secret, gives `401` and `invalid_client`.
- **Acceptance 4, expired access token gets `401` and refresh after the session ends gets `invalid_grant`:** not proven. My `npx vitest run` (138 passed) went through `| tail` in a call that also used `;`. Missing: a saved test log.
- **Acceptance 5, a secret under 32 characters throws at start:** not proven. The `mount.test.ts` assertions passed in the same piped `npx vitest run`. Missing: a saved test log.
- **Typecheck and build:** not proven. `npm run typecheck` and `npm run build` printed no errors, but they ran in the same piped, `;`-joined call.
- **Easy-to-miss rule** ("Blocking is only a proven break of an acceptance bullet. PLAUSIBLE is never blocking."): followed. My previous message labels each finding proven, plausible or unverified, has no blocking finding, and opens with PASS. No file holds this evidence. The only evidence is that message.
