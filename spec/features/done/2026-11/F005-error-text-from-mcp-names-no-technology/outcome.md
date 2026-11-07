# Outcome

A failed `callTool` now returns one of three neutral codes, `ACCESS_DENIED`, `INVALID_INPUT` or `SERVER_ERROR`, and its text names no technology. Access-denied and invalid-input messages are kept, with `Variable "$x"` shown as `Argument "x"`; a server error, or a kept message that names the stack, becomes a fixed sentence, and the server logs the original error. Landed in `c09b224` (worker commit `49de058`).

All ten Keystone `KS_` codes in `@keystone-6/core` are mapped by meaning in `src/server.ts`. A new Keystone code falls back to `SERVER_ERROR` until it is mapped. A catalog rejection now returns the same JSON shape with `INVALID_INPUT`, not plain text. This replaces the first version's choice that `/mcp` errors match `/api/graphql`.
