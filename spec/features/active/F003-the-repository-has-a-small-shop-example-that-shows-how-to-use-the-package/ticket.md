---
opened: 2026-11-07
---

# F003 · The repository has a small shop example that shows how to use the package

## Outcome

A developer who opens the repository finds `examples/shop`: a small Keystone 6 online shop that uses `keystone-mcp`. With the commands in its README they start it, browse the shop in a browser, and connect Claude Desktop to it. The example shows the wiring in `keystone.ts` and the access rules that make `/mcp` safe, so it is the first place to look before using the package.

## Scope

- A Keystone 6 app with SQLite and seed data: categories, products (price, stock, published or draft), customers, and orders with order lines and a status.
- Access rules: anyone reads published products and categories; a signed-in customer reads only their own orders; an admin does everything.
- A minimal storefront, served by the same `extendExpressApp` function that mounts `keystoneMcp()`: a product list and a product page. Server-rendered HTML, no frontend framework. It reads as the session of the request.
- `examples/shop/README.md`: install and start, the seed accounts, how to reach the app over a public HTTPS tunnel, how to add it in Claude Desktop, and five example requests such as "Which products are low on stock?" and "Mark the newest order as shipped".
- The example depends on the package in this repository, so it runs from a fresh clone before and after publishing. The root README links to it.

## Out of scope

- Payments, a cart, a checkout or images.
- A Next.js or other frontend app.
- Changes to the package in `src/`. If the example finds a package defect, report it in notes.md.

## Acceptance

- From a fresh clone, the commands in `examples/shop/README.md` start the app, and `/` shows the published products.
- A draft product is missing from the storefront, and an anonymous `/api/graphql` query cannot read it.
- A scripted OAuth flow against the running example (the pattern of `test/oauth.ts`) signs in as the seed admin and as a seed customer; the admin updates a product's stock through `callTool`, and the customer gets `KS_ACCESS_DENIED` for the same update and sees only their own orders.
- The Admin UI at `/signin` renders without a build error.
- `npm pack --dry-run` in the root lists no file under `examples/`, and root `npm test` and `npm run build` still pass.

## Notes

- Lessons from the scratch apps: do not set `"type": "commonjs"` in the example's `package.json` (the Admin UI build fails); install the local package as a copy (`--install-links`), as the root README says; set Express `trust proxy` for the tunnel.
- Seed passwords are examples for local use only; the README says so.
