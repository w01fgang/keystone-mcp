# Outcome

The test suite now passes on every run. The test servers listened on all interfaces but the tests called `127.0.0.1`. On macOS another program could bind `127.0.0.1` on the same port, and its answers (404, 501, a 401 with no `WWW-Authenticate`) failed a random test. The tests now bind `127.0.0.1`, so such a bind fails instead. Test commit `64c39d8`, closed in `e933db9`.

Proof: `cause.log` holds the failing runs, a 180-second probe (171 of 51,300 requests lost on all interfaces, 0 on `127.0.0.1`), and `lsof` output of the Dia browser's agent server on the same port as a test server. `runs-after-fix.log` shows 50 of 50 runs pass with 138 tests each; the coordinator ran 15 more at `64c39d8`, all passing.

This was not a defect of the package: an app chooses its own listen address. The worker's original pre-fix run logs were deleted; `cause.log` keeps copies.
