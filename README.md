# keystone-mcp

Mount an [MCP](https://modelcontextprotocol.io) endpoint on the Express server of a Keystone 6 app.
MCP clients get two tools:

- `searchTool` finds the GraphQL queries and mutations of the app, with their argument signatures and the field paths that a call can select.
- `callTool` runs one of these operations as the session of the request.

The package uses only the public hook `server.extendExpressApp` and the public context. It does not modify `@keystone-6/core`.

## Install

The package is not on npm yet. Use a `file:` dependency, installed as a copy so that the package shares the `graphql` and `express` copies of the app:

```sh
npm install --install-links /path/to/keystone-mcp
```

Put `install-links=true` in the `.npmrc` of the app to keep later installs as copies. After you rebuild the package, run `rm -rf node_modules/keystone-mcp && npm install` in the app to refresh the copy.

The package ships ESM (`dist/index.js`) and CommonJS (`dist/cjs/index.js`). Keystone compiles `keystone.ts` to CommonJS and loads the CommonJS build.

## Wire it in `keystone.ts`

```ts
import { config } from '@keystone-6/core';
import { keystoneMcp } from 'keystone-mcp';

export default config({
  db: { /* ... */ },
  lists,
  session,
  server: {
    extendExpressApp: keystoneMcp(),
  },
});
```

To keep another `extendExpressApp` function, call both:

```ts
const mcp = keystoneMcp({ queriesOnly: true });

server: {
  extendExpressApp: (app, context) => {
    app.get('/health', (_req, res) => res.json({ ok: true }));
    mcp(app, context);
  },
},
```

## Options

| Option        | Default | Effect                                                                    |
| ------------- | ------- | ------------------------------------------------------------------------- |
| `path`        | `/mcp`  | The HTTP path of the endpoint.                                            |
| `queriesOnly` | `false` | When `true`, the catalog holds queries only, and `callTool` cannot mutate. |
| `takeLimit`   | `50`    | The maximum `take` that `callTool` sends, in either direction. A missing `take` becomes this. A negative `take` reads from the end and stops at `-takeLimit`. |
| `introspection` | `NODE_ENV !== 'production'` | When `false`, `searchTool` returns a tool error that names this option, and `callTool` still runs operations by name. The default follows Apollo Server's `introspection` default. Keystone does not pass the app's `graphql.apolloConfig` to `extendExpressApp`, so to match it, pass the same value to both. |

## Behavior

- `POST <path>` serves a stateless MCP Streamable HTTP endpoint with JSON responses. Each request creates a new MCP server.
- `GET <path>` and `DELETE <path>` respond `405` with JSON-RPC error code `-32000`.
- `callTool` runs `context.withRequest(req, res)` and then `context.graphql.run`. Keystone access control applies as for any GraphQL request. With `statelessSessions`, MCP clients send the session token as `Authorization: Bearer <token>`.
- When the GraphQL call fails, `callTool` returns a tool error whose text is `{"errors":[{"message":…,"extensions":{"code":…}}]}`, with the message and code that `/api/graphql` gives for the same failure. An error that Prisma caused becomes `Prisma error` with code `KS_PRISMA_ERROR`. The app's `graphql.apolloConfig.formatError` does not run on this path.
- The catalog skips the root field `keystone`. Keystone builds a new catalog after each dev rebuild.
- The JSON body parser runs on the MCP path only.

## Tool input

`searchTool`:

```json
{ "text": "posts", "limit": 10 }
```

`callTool`:

```json
{
  "operation": "posts",
  "args": { "where": { "title": { "contains": "mcp" } }, "take": 5 },
  "select": ["id", "title", "author.name"]
}
```

Without `select`, `callTool` selects the top-level paths of the operation.
