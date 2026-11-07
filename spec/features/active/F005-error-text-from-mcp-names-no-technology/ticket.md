---
touches:
  - keystone-mcp.server
opened: 2026-11-07
---

# F005 · Error text from /mcp names no technology

## Outcome

When a `callTool` call fails, the agent reads what went wrong in neutral words: access was denied, an argument was wrong, or the server failed. The error no longer shows codes or messages that name the stack, such as `KS_ACCESS_DENIED` or `Prisma error`. This extends the owner's rule that what the agent reads tells it about the project, not the technology under it, to errors. It reverses the first version's choice that `/mcp` errors match `/api/graphql`.

## Scope

- Map each error to a neutral code by meaning: denied access becomes `ACCESS_DENIED`, a wrong argument or a failed validation becomes `INVALID_INPUT`, and every other failure becomes `SERVER_ERROR`. Check the Keystone error codes with jg in `node_modules/@keystone-6/core` and map each one.
- Keep a message when it helps the agent fix the call and names no technology (an access-denied message, a validation message from the app, the name of a wrong argument). Replace every other message, including the message of an unexpected error, with one fixed sentence.
- Log the original error on the server, so the app owner can still find the cause.
- Starting seam: `formatGraphQLError` in `src/server.ts`. Update the README Behavior lines on errors and on agent-facing text.

## Out of scope

- `/api/graphql` and its errors.
- OAuth error responses (`invalid_grant` and others). They are the OAuth standard.
- A plain-word message for a unique-value conflict.

## Acceptance

- On the running shop example, a customer's `updateProduct` returns code `ACCESS_DENIED` with a message that names no technology.
- A duplicate category `slug` created by the admin returns `SERVER_ERROR` with the fixed sentence, and the server log holds the original database error.
- `products` with `take: "many"` returns `INVALID_INPUT` with a message that names the argument `take`.
- A test fails if a `callTool` error text contains `keystone`, `graphql` or `prisma` (case-insensitive) or a code that starts with `KS_`.
- `npm test` and `npm run build` pass.
