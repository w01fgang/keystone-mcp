# keystone-mcp

Mount an [MCP](https://modelcontextprotocol.io) endpoint on the Express server of a Keystone 6 app.
MCP clients get two tools:

- `searchTool` finds the GraphQL queries and mutations of the app, with their argument signatures and the field paths that a call can select.
- `callTool` runs one of these operations as the user who signed in.

An MCP client such as Claude Desktop connects with OAuth: the user signs in with their Keystone email and password in the browser, and the client then acts as that user. Keystone access control decides what it can do.

The package uses only the public hook `server.extendExpressApp` and the public context. It does not modify `@keystone-6/core`.

For a working app, start with the shop example in [`examples/shop`](examples/shop/README.md): a small Keystone 6 shop with access rules, seed data, a storefront, and the steps to connect Claude Desktop.

## Install

The package is not on npm yet. Use a `file:` dependency, installed as a copy so that the package shares the `graphql` and `express` copies of the app:

```sh
npm install --install-links /path/to/keystone-mcp
```

Put `install-links=true` in the `.npmrc` of the app to keep later installs as copies. After you rebuild the package, run `rm -rf node_modules/keystone-mcp && npm install` in the app to refresh the copy.

The package ships ESM (`dist/index.js`) and CommonJS (`dist/cjs/index.js`). Keystone compiles `keystone.ts` to CommonJS and loads the CommonJS build.

## Wire it in `keystone.ts`

The package needs password sign-in from `@keystone-6/auth` (`createAuth`), because users sign in to the MCP endpoint with it. Without an `authenticate<List>WithPassword` mutation in the schema, `keystoneMcp` throws at start.

```ts
import { config } from '@keystone-6/core';
import { createAuth } from '@keystone-6/auth';
import { keystoneMcp } from 'keystone-mcp';

const { withAuth } = createAuth({ listKey: 'User', identityField: 'email', secretField: 'password' });

export default withAuth(
  config({
    db: { /* ... */ },
    lists,
    session,
    server: {
      extendExpressApp: keystoneMcp({
        instructions: 'The blog of Example Inc. Authors write posts; readers leave comments.',
      }),
    },
  }),
);
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
| `introspection` | `NODE_ENV !== 'production'` | When `false`, `searchTool` returns a tool error that asks the agent to have the app's owner turn search on, and `callTool` still runs operations by name. The server instructions still name the operations for one record. The default follows Apollo Server's `introspection` default. Keystone does not pass the app's `graphql.apolloConfig` to `extendExpressApp`, so to match it, pass the same value to both. |
| `instructions` | none | One paragraph about the project, in your words. The server instructions start with it, before the part that the package builds from the catalog. |

## Behavior

- `POST <path>` serves a stateless MCP Streamable HTTP endpoint with JSON responses. Each request creates a new MCP server.
- `GET <path>` and `DELETE <path>` respond `405` with JSON-RPC error code `-32000`.
- A `POST <path>` without a valid access token gets `401` with `WWW-Authenticate: Bearer … resource_metadata="<origin>/.well-known/oauth-protected-resource<path>"`.
- `callTool` runs `context.withRequest(req, res)` and then `context.graphql.run`, with the Keystone session of the user behind the access token. Keystone access control applies as for any GraphQL request.
- When the GraphQL call fails, `callTool` returns a tool error whose text is `{"errors":[{"message":…,"extensions":{"code":…}}]}`, with the message and code that `/api/graphql` gives for the same failure. An error that Prisma caused becomes `Prisma error` with code `KS_PRISMA_ERROR`. The app's `graphql.apolloConfig.formatError` does not run on this path.
- The `initialize` result carries `instructions` for the client: the `instructions` option first, then the kinds of records in plain words (from the list names, for example `products` and `order lines`), the operations for one record of each kind, and how to search and call. With `introspection` off, it still names the operations.
- The text that the agent reads (server instructions, tool and argument descriptions, the search-off message, the sign-in page and the session-ended errors) describes the project and names no technology: no Keystone, GraphQL or Prisma. Error text from a failed call stays as `/api/graphql` gives it.
- The catalog skips the root field `keystone`. Keystone builds a new catalog after each dev rebuild.
- The JSON and form body parsers run on `<path>` and `<path>/oauth/*` only.

## Sign-in (OAuth 2.1)

The package is the OAuth authorization server for its own endpoint. It serves:

| Path | Purpose |
| ---- | ------- |
| `/.well-known/oauth-protected-resource<path>` and `/.well-known/oauth-protected-resource` | Protected resource metadata (RFC 9728). |
| `/.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414). The issuer is the origin of the app. |
| `<path>/oauth/register` | Dynamic client registration (RFC 7591). Redirect URIs must use `https`, or `http` on a loopback host. |
| `<path>/oauth/authorize` | The sign-in and consent page. It shows the host that the browser returns to. |
| `<path>/oauth/token` | Code exchange with S256 PKCE, and refresh. Each refresh returns a new refresh token, and the old one then gets `invalid_grant`. |
| `<path>/oauth/revoke` | Token revocation (RFC 7009). |

- Redirect URIs match exactly. Only the port of a loopback redirect (`localhost`, `127.0.0.1`, `[::1]`) can differ from the registered one.
- The sign-in page runs the app's password mutation. The Keystone session token stays on the server; the client gets its own access token (1 hour) and refresh token.
- The grant ends with the Keystone session: when the session expires (`statelessSessions` `maxAge`, 8 hours by default) or the user is deleted, `/mcp` answers `401` and refresh answers `invalid_grant`, so the client asks the user to sign in again.
- Clients and tokens live in the memory of the process. After a restart or a dev rebuild, each user signs in again. Run one process per app.
- The issuer and resource URLs come from each request: `req.protocol` and the `Host` header. Behind a proxy or tunnel that ends TLS, set Express `trust proxy`, so that the URLs use `https`:

```ts
const mcp = keystoneMcp();

server: {
  extendExpressApp: (app, context) => {
    app.set('trust proxy', 1);
    mcp(app, context);
  },
},
```

## Connect Claude Desktop

Claude connects from Anthropic's cloud (`160.79.104.0/21`), so the app must be reachable over public HTTPS. For a local app, use a tunnel, for example `cloudflared tunnel --url http://localhost:3000`, and set `trust proxy` as above.

1. In Claude Desktop, open **Customize > Connectors**. On a Team or Enterprise plan, an Owner adds the connector in **Organization settings > Connectors** with **Add**, then **Custom**.
2. Click **Add custom connector**.
3. Enter a name, for example `Keystone`, and the URL of the endpoint, for example `https://cms.example.com/mcp`. The URL must be the app's public origin followed by `path`.
4. If the dialog asks how Claude identifies itself, choose **Register automatically**. The package supports dynamic client registration, not Claude's published identity. Leave the OAuth client ID and secret empty.
5. Click **Add**, then **Connect**. A browser window opens the sign-in page of the app.
6. Check that the page says your browser goes to `claude.ai`. Enter your Keystone email and password, and click **Sign in and allow**.
7. The browser returns to Claude, and the connector shows as connected. Ask Claude, for example, "Find the posts with draft status and publish the first one."

Claude acts as the user who signed in. A user who may not update a post in the Admin UI cannot update it through Claude either.

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
