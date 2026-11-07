# Outcome

`examples/shop` is a small Keystone 6 shop that uses `keystone-mcp`: categories, products with stock and a draft or published status, customers, and orders with order lines. A server-rendered storefront at `/` lists the products, and its README goes from a fresh clone to Claude Desktop. Landed in `6270bfe`.

The storefront owns `/`, so the Admin UI is at `/admin` (`ui.basePath`), and `/signin` redirects to `/admin/signin`. The coordinator accepted this as meeting the Admin UI acceptance line. A scripted OAuth flow proved that the admin can change stock through `callTool`, that a customer gets `KS_ACCESS_DENIED` and sees only their own orders, and that drafts stay hidden from anonymous readers. Nobody has run the README's Claude Desktop steps against the example yet.

The example depends on the package through `file:../..`. Root `npm pack` ships no file under `examples/`.
