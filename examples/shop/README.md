# Shop example

A small Keystone 6 online shop that uses `keystone-mcp`. It has a storefront, an Admin UI, and an MCP endpoint at `/mcp`. Claude Desktop connects to `/mcp`, signs in as a shop user, and can then read and change the shop within that user's access rules. It runs on `@keystone-6/core` 8.3, `@keystone-6/auth` 10 and Prisma 7.

| File | What it shows |
| ---- | ------------- |
| `keystone.ts` | The wiring: `createAuth`, `keystoneMcp()` with a paragraph about the shop for the agent and `secret` from `MCP_SECRET`, the storefront, and `trust proxy`, all in one `extendExpressApp` function. It opens the SQLite database through the Prisma adapter `@prisma/adapter-better-sqlite3`. |
| `prisma.config.ts` | The database file for `prisma db push`, which `keystone dev` runs at start. It names the same file as `keystone.ts`. |
| `schema.ts` | The lists and the access rules that make `/mcp` safe. |
| `storefront.ts` | Two server-rendered pages: the product list at `/` and a product page at `/products/<slug>`. |
| `seed.ts` | The example data that fills an empty database at start. |

## Start

You need Node.js and npm. The example was tested with Node.js 24.

```sh
git clone <this repository> keystone-mcp
cd keystone-mcp
npm install
npm run build
cd examples/shop
npm install
export SESSION_SECRET="$(openssl rand -hex 32)"
export MCP_SECRET="$(openssl rand -hex 32)"
npm run dev
```

- `npm run build` in the repository root builds the package into `dist`. The example depends on it with `"keystone-mcp": "file:../.."`.
- The `.npmrc` of the example sets `install-links=true`, so npm installs the package as a copy, not as a link. The copy then shares the `graphql` and `express` copies of Keystone.
- On the first start, Keystone creates `keystone.db` (SQLite) and the seed data. It also writes the Prisma client and the TypeScript types into `generated/`, which Git ignores.
- `SESSION_SECRET` keeps the sign-ins of the Admin UI and of MCP clients when `keystone dev` rebuilds after you edit a file. Without it, Keystone makes a new session secret each time it loads `keystone.ts`.
- `MCP_SECRET` goes to `keystoneMcp({ secret })`. With it and `SESSION_SECRET`, MCP clients also stay signed in after a restart, and on a second process started with the same two values.
- The log shows the MCP endpoint: `keystone-mcp: MCP endpoint at /mcp: 48 operations, search on, sign-in with authenticateUserWithPassword, sign-ins sealed with secret.` Without `MCP_SECRET`, it ends with `sign-ins end at restart; keystoneMcp({ secret }) keeps them.`

Open:

- <http://localhost:3000/>: the storefront.
- <http://localhost:3000/admin>: the Admin UI. The storefront owns `/`, so `keystone.ts` moves the Admin UI to `/admin` with `ui.basePath`.

After you change the package in the root, run `npm run build` there, and then `rm -rf node_modules/keystone-mcp && npm install` here to refresh the copy. To reset the data, stop the app, delete `keystone.db`, and start it again.

## Seed accounts

| Email | Password | Role |
| ----- | -------- | ---- |
| `admin@example.com` | `shop-admin-1234` | Admin |
| `carl@example.com` | `shop-carl-1234` | Customer with two orders |
| `dana@example.com` | `shop-dana-1234` | Customer with two orders |

These passwords are examples for local use only. Change them, or delete the seed accounts, before anyone else can reach the app.

## Access rules

The rules are in `schema.ts`. Keystone applies them to every request: the storefront, `/api/graphql`, the Admin UI and `/mcp`.

| Who | Products and categories | Orders and order lines | Users |
| --- | ----------------------- | ---------------------- | ----- |
| Anyone | Reads published products and all categories | Nothing | Nothing |
| A signed-in customer | Reads published products and all categories | Reads their own | Reads their own |
| An admin | Reads and writes everything, drafts included | Reads and writes all | Reads and writes all |

Only an admin can open the Admin UI (`ui.isAccessAllowed`). A customer uses the storefront and an MCP client.

The storefront reads with `context.withRequest(req, res)`, so it sees what the session of the request may see. An anonymous visitor does not see the draft products; a signed-in admin sees them with a `draft` badge.

## Connect MCP Inspector on your computer

A client on your computer connects to `http://localhost:3000/mcp` directly, with no tunnel.

1. Run `npx @modelcontextprotocol/inspector`. It opens its page in the browser.
2. Click **Add Servers**, then **+ Add manually**. Enter the server ID `shop`, choose the transport `streamable-http`, enter the URL `http://localhost:3000/mcp`, and click **Add**.
3. Turn on the switch of the `shop` server. The browser opens the sign-in page of the shop. It says that the browser goes to `127.0.0.1:6274`, the address of MCP Inspector.
4. Sign in as `carl@example.com` with `shop-carl-1234`, and click **Sign in and allow**. MCP Inspector shows the server as connected.
5. Open **Tools** and choose `callTool`. Enter the operation `products` and the select `["name", "priceCents"]`, and click **Execute Tool**. The result lists the six published products; Carl does not see the two drafts.

Edit `schema.ts`, for example add `graphql: { omit: { delete: true } }` to `Category`. `keystone dev` rebuilds and logs `46 operations`. The signed-in client keeps working with the same token, without a new sign-in.

## Reach the app over HTTPS

Claude connects from Anthropic's cloud, not from your computer, so the app must be reachable over public HTTPS. For a local app, use a tunnel. With [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/):

```sh
cloudflared tunnel --url http://localhost:3000
```

It prints a URL such as `https://random-words.trycloudflare.com`. The MCP endpoint is that URL followed by `/mcp`.

The tunnel ends TLS and forwards plain HTTP to the app. `keystone.ts` sets Express `trust proxy`, so the app reads `X-Forwarded-Proto` and gives Claude `https` URLs for the sign-in.

## Add the shop in Claude Desktop

1. In Claude Desktop, open **Customize > Connectors**. On a Team or Enterprise plan, an Owner adds the connector in **Organization settings > Connectors** with **Add**, then **Custom**.
2. Click **Add custom connector**.
3. Enter the name `Shop` and the URL of the endpoint, for example `https://random-words.trycloudflare.com/mcp`.
4. If the dialog asks how Claude identifies itself, choose **Register automatically**. Leave the OAuth client ID and secret empty.
5. Click **Add**, then **Connect**. A browser window opens the sign-in page of the shop.
6. Check that the page says your browser goes to `claude.ai`. Sign in as `admin@example.com` with `shop-admin-1234`, and click **Sign in and allow**.
7. The browser returns to Claude, and the connector shows as connected.

With `MCP_SECRET` and `SESSION_SECRET` set to the same values, the sign-in survives a dev rebuild and a restart. Without `MCP_SECRET`, it lives in the memory of the app, and after a restart you connect again in Claude.

## Ask Claude

Signed in as the admin, try:

1. "Which products are low on stock?"
2. "Mark the newest order as shipped."
3. "Publish the Winter Blend and set its stock to 50."
4. "What has Carl Customer ordered, and what is the status of each order?"
5. "Add 20 to the stock of Earl Grey."

Claude finds the operations with `searchTool` and runs them with `callTool`. Each change shows in the storefront and in the Admin UI.

Disconnect, connect again as `carl@example.com`, and ask "Show my orders": Claude sees Carl's two orders only. Ask it to change the stock of a product: the shop denies the update, and Claude gets the code `ACCESS_DENIED`, as the Admin UI would deny it.

## Run as in production

```sh
npm run build
NODE_ENV=production SESSION_SECRET="$(openssl rand -hex 32)" MCP_SECRET="$(openssl rand -hex 32)" npm start
```

With `NODE_ENV=production`, `keystoneMcp()` turns introspection off by default. The log says `search off (NODE_ENV=production); keystoneMcp({ introspection: true }) turns it on`, and `searchTool` returns an error that asks for search to be turned on; `callTool` still works. To keep `searchTool`, pass `keystoneMcp({ introspection: true })`.
