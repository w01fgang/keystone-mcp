# keystone-mcp

Mount an [MCP](https://modelcontextprotocol.io) endpoint on the Express server of a Keystone 6 app.

## What the users of your app get

- A user adds `https://<your app>/mcp` to an MCP client, such as Claude Desktop, Claude Code or MCP Inspector. The client opens a page of your app, where the user signs in with their email and password and allows the client.
- The agent in the client gets two tools. `searchTool` finds the queries and mutations of the app, with their arguments and the field paths that a call can select. `callTool` runs one of them.
- The agent acts as the user who signed in. Keystone access control decides what it can read and change, as in the Admin UI: a user who may not update a post cannot update it through the agent either.
- When it connects, the agent reads a short description of the project: your paragraph, then the kinds of records in plain words.

The package uses only the public hook `server.extendExpressApp` and the public context. It does not modify `@keystone-6/core`.

For a working app, start with the shop example in [`examples/shop`](examples/shop/README.md): a small Keystone 6 shop with access rules, seed data, a storefront, and the steps to connect MCP Inspector and Claude Desktop.

## Install

```sh
npm install keystone-mcp
```

The app must have `express` and `graphql` installed; Keystone 6 brings both.

To try a local checkout instead, install it as a copy, so that the package shares the `graphql` and `express` copies of the app: `npm install --install-links /path/to/keystone-mcp`.

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

At start, and again after each `keystone dev` rebuild, the server log shows one line for the endpoint:

```text
keystone-mcp: MCP endpoint at /mcp: 48 operations, search on, sign-in with authenticateUserWithPassword.
```

It names the path, the number of operations that the agent can find, whether `searchTool` is on, and the mutation that the sign-in page runs. When search is off, the line names the reason and the option that turns it on: `search off (NODE_ENV=production); keystoneMcp({ introspection: true }) turns it on`.

## Try it on your computer

An MCP client that runs on your computer, such as MCP Inspector or Claude Code, connects to `http://localhost:3000/mcp` directly. It needs no tunnel, no HTTPS and no `trust proxy`.

1. Start the app with a fixed session secret:

   ```sh
   export SESSION_SECRET="$(openssl rand -hex 32)"
   npm run dev
   ```

   `keystone.ts` must pass it to the session, for example `session: statelessSessions({ secret: process.env.SESSION_SECRET })`. Without a fixed secret, Keystone makes a new one each time it loads `keystone.ts`, also at each dev rebuild, and the client must sign in again after each edit.

2. Find the mount line in the log: `keystone-mcp: MCP endpoint at /mcp: … operations, search on, …`.

3. Connect a client.

   - MCP Inspector: run `npx @modelcontextprotocol/inspector`. It opens its page in the browser. Click **Add Servers**, then **+ Add manually**. Enter the server ID `shop`, choose the transport `streamable-http`, enter the URL `http://localhost:3000/mcp`, and click **Add**. Then turn on the switch of the `shop` server.
   - Claude Code: run `claude mcp add --transport http shop http://localhost:3000/mcp`. `claude mcp list` then shows `shop` with `! Needs authentication`. In Claude Code, run `/mcp`, choose `shop`, and choose **Authenticate**.

4. The browser opens the sign-in page of the app. The page says where the browser goes next: the client's own address on your computer, for example `127.0.0.1:6274` for MCP Inspector. Sign in as a user of the app, and click **Sign in and allow**.

5. Run a call. In MCP Inspector, open **Tools** and choose `callTool`. Enter the operation `products` and the select `["name"]`, and click **Execute Tool**. The result holds the products that this user may read. In Claude Code, ask for the products.

After a schema edit, `keystone dev` rebuilds and logs the mount line again, with the new number of operations. The client stays signed in. After a restart of the process, it signs in again.

## Before you deploy

- **`SESSION_SECRET`.** Set a random string of 32 characters or more, and pass it to `statelessSessions`. Without it, each start makes a new secret, and every user signs in again.
- **`trust proxy`.** Behind a proxy or tunnel that ends TLS, set Express `trust proxy` in `extendExpressApp`. Without it, Express reads each request as `http`, the OAuth URLs use `http`, and a client that connected over `https` refuses them. The server log warns once per process when a request has `X-Forwarded-Proto: https` but Express reads `http`:

  ```text
  keystone-mcp: a request to /.well-known/oauth-protected-resource/mcp has X-Forwarded-Proto: https, but Express reads it as http, so the OAuth URLs use http and MCP clients refuse them. Behind a proxy or tunnel that ends TLS, call app.set('trust proxy', 1) in extendExpressApp.
  ```

  ```ts
  const mcp = keystoneMcp();

  server: {
    extendExpressApp: (app, context) => {
      app.set('trust proxy', 1);
      mcp(app, context);
    },
  },
  ```

- **`introspection`.** With `NODE_ENV=production`, `searchTool` is off by default, as in Apollo Server, and the mount line says so. To keep search, pass `keystoneMcp({ introspection: true })`. `callTool` works either way.
- **One process.** Clients and tokens live in the memory of the process. They survive a dev rebuild, but not a restart, and another process does not know them. Run one process per app.

## Connect Claude Desktop

Claude connects from Anthropic's cloud (`160.79.104.0/21`), so the app must be reachable over public HTTPS. For a local app, use a tunnel, for example `cloudflared tunnel --url http://localhost:3000`, and set `trust proxy` (see [Before you deploy](#before-you-deploy)). To try the endpoint without a tunnel, use a local client: see [Try it on your computer](#try-it-on-your-computer).

1. In Claude Desktop, open **Customize > Connectors**. On a Team or Enterprise plan, an Owner adds the connector in **Organization settings > Connectors** with **Add**, then **Custom**.
2. Click **Add custom connector**.
3. Enter a name, for example `Keystone`, and the URL of the endpoint, for example `https://cms.example.com/mcp`. The URL must be the app's public origin followed by `path`.
4. If the dialog asks how Claude identifies itself, choose **Register automatically**. The package supports dynamic client registration, not Claude's published identity. Leave the OAuth client ID and secret empty.
5. Click **Add**, then **Connect**. A browser window opens the sign-in page of the app.
6. Check that the page says your browser goes to `claude.ai`. Enter your Keystone email and password, and click **Sign in and allow**.
7. The browser returns to Claude, and the connector shows as connected. Ask Claude, for example, "Find the posts with draft status and publish the first one."

Claude acts as the user who signed in. A user who may not update a post in the Admin UI cannot update it through Claude either.

## Control what the agent can do

Keystone access control applies to each call. Two more levers exist in Keystone today.

**Hide a list or an operation with `graphql.omit`.** The catalog comes from the public GraphQL schema, so an operation that the schema omits is gone from `searchTool` and `callTool`, and from `/api/graphql` too:

```ts
Category: list({
  access: allowAll,
  // No deleteCategory and no deleteCategories, for any client.
  graphql: { omit: { delete: true } },
  fields: { /* ... */ },
}),
```

**Tell an MCP call from other calls with `context.req`.** `callTool` runs with the context of the `POST <path>` request, so a hook sees `context.req.url` equal to `path`, for example `/mcp`. A request to `/api/graphql` has another `url`:

```ts
hooks: {
  beforeOperation: ({ operation, context }) => {
    if (context.req?.url === '/mcp') console.log(`An MCP client runs ${operation}.`);
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
- When a call fails, `callTool` returns a tool error whose text is `{"errors":[{"message":…,"extensions":{"code":…}}]}` with one of three codes. `ACCESS_DENIED`: Keystone denied access (`KS_ACCESS_DENIED`, `KS_FILTER_DENIED`). `INVALID_INPUT`: an argument has the wrong type, a validation failed, a `take` exceeds the list's limit, or the catalog rejects the input (`KS_USER_INPUT_ERROR`, `KS_VALIDATION_FAILURE`, `KS_LIMITS_EXCEEDED`). `SERVER_ERROR`: every other failure, such as a database error (`KS_PRISMA_ERROR`), a hook that throws, an access function that does not return a boolean, or an unknown code. A list of field errors (`KS_RELATIONSHIP_ERROR`, `KS_RESOLVER_ERROR`, `KS_EXTENSION_ERROR`) gets `ACCESS_DENIED` or `INVALID_INPUT` only when each of its field errors has that meaning.
- An `ACCESS_DENIED` or `INVALID_INPUT` error keeps its message, because the message helps the agent fix the call; a wrong argument is named as `Argument "take"`. A `SERVER_ERROR` gets a fixed sentence, and so does any message that names Keystone, GraphQL, Prisma or Apollo. When the agent gets a fixed sentence, the server logs the original error with `console.error`. `/api/graphql` keeps Keystone's own codes and messages, and the app's `graphql.apolloConfig.formatError` does not run on `<path>`.
- The `initialize` result carries `instructions` for the client: the `instructions` option first, then the kinds of records in plain words (from the list names, for example `products` and `order lines`), the operations for one record of each kind, and how to search and call. With `introspection` off, it still names the operations.
- The text that the agent reads (server instructions, tool and argument descriptions, the search-off message, the sign-in page, the session-ended errors and the errors of a failed call) describes the project and names no technology: no Keystone, GraphQL or Prisma.
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
- Clients and tokens live in the memory of the process. They survive a `keystone dev` rebuild, because Keystone keeps the package loaded. After a restart, each user signs in again. Run one process per app.
- The issuer and resource URLs come from each request: `req.protocol` and the `Host` header. Behind a proxy or tunnel that ends TLS, set Express `trust proxy`, so that the URLs use `https`. See [Before you deploy](#before-you-deploy).

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
