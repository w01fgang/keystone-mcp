# Shop example

A small Keystone 6 online shop that uses `keystone-mcp`. It has a storefront, an Admin UI, and an MCP endpoint at `/mcp`. Claude Desktop connects to `/mcp`, signs in as a shop user, and can then read and change the shop within that user's access rules.

| File | What it shows |
| ---- | ------------- |
| `keystone.ts` | The wiring: `createAuth`, `keystoneMcp()`, the storefront, and `trust proxy`, all in one `extendExpressApp` function. |
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
npm run dev
```

- `npm run build` in the repository root builds the package into `dist`. The example depends on it with `"keystone-mcp": "file:../.."`.
- The `.npmrc` of the example sets `install-links=true`, so npm installs the package as a copy, not as a link. The copy then shares the `graphql` and `express` copies of Keystone.
- On the first start, Keystone creates `keystone.db` (SQLite) and the seed data.

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

Only an admin can open the Admin UI (`ui.isAccessAllowed`). A customer uses the storefront and Claude.

The storefront reads with `context.withRequest(req, res)`, so it sees what the session of the request may see. An anonymous visitor does not see the draft products; a signed-in admin sees them with a `draft` badge.

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

The sign-in lives in the memory of the app. After a restart, or after a dev rebuild when you edit a file, connect again in Claude. The app also makes a new session secret at each start unless you set `SESSION_SECRET` to a random string of 32 characters or more.

## Ask Claude

Signed in as the admin, try:

1. "Which products are low on stock?"
2. "Mark the newest order as shipped."
3. "Publish the Winter Blend and set its stock to 50."
4. "What has Carl Customer ordered, and what is the status of each order?"
5. "Add 20 to the stock of Earl Grey."

Claude finds the operations with `searchTool` and runs them with `callTool`. Each change shows in the storefront and in the Admin UI.

Disconnect, connect again as `carl@example.com`, and ask "Show my orders": Claude sees Carl's two orders only. Ask it to change the stock of a product: Keystone denies the update with `KS_ACCESS_DENIED`, as it would in the Admin UI.

## Run as in production

```sh
npm run build
NODE_ENV=production SESSION_SECRET="$(openssl rand -hex 32)" npm start
```

With `NODE_ENV=production`, `keystoneMcp()` turns introspection off by default, and `searchTool` returns an error that names the `introspection` option; `callTool` still works. To keep `searchTool`, pass `keystoneMcp({ introspection: true })`.
