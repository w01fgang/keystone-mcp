---
opened: 2026-11-07
---

# F006 · Every Keystone field type works through searchTool and callTool

## Outcome

The test suite proves that an agent can find, read, filter, create, update and delete items through `/mcp` for every field type that Keystone ships today. The current tests use a hand-written GraphQL fixture (`test/schema.ts`), so the package was never checked against the schema that real Keystone fields produce. A defect that this test finds is fixed in the same branch.

## Scope

- A real Keystone 6 app inside the test suite, on the current npm release (`@keystone-6/core` 8.3.0, `@keystone-6/fields-document` 11.0.6, `@keystone-6/cloudinary` 10.0.6) as dev dependencies only, with SQLite.
- Lists that cover every type in `packages/core/src/fields/types` of the Keystone checkout at `../keystone`: bigInt, bytes, calendarDay, checkbox, decimal, file, float, image, integer, json, multiselect, password, relationship, select, text, timestamp, virtual. Also `document` and `cloudinaryImage`.
- The variants that change the GraphQL shape: select as string, integer and enum; relationship one, many and two-sided; virtual with arguments and with an object type; `isNullable`, `isRequired` and default values where a field supports them.
- Each field goes through the MCP server as a signed-in session: the operation appears in `searchTool`, `callTool` writes a value and reads it back, and a filter on the field works where Keystone offers one.
- Starting seam: the tool flow in `test/server.test.ts`, run against the context of the real app instead of the fixture.

## Out of scope

- Changes to `@keystone-6/core` or to `../keystone`.
- Uploads of file content through `callTool`, and calls to Cloudinary. For file, image and cloudinaryImage, the catalog and a read of a stored item are enough.
- A new MCP tool, or a change to the five options.

## Acceptance

- `npm ci`, then `npm test`, from a fresh clone runs the field-type tests and passes with no network.
- Each field type has a test named for its behavior; a type the suite cannot exercise is in `notes.md` with the reason.
- `callTool` keeps the session's access: a list with an access rule refuses an anonymous write.
- No tool text or error text from `/mcp` names Keystone, GraphQL or Prisma for any of these fields.
- `npm pack --dry-run` lists no new file, and `dependencies` in `package.json` do not change.
- `npm run typecheck` passes.

## Notes

- `examples/shop/package.json` asks for `@keystone-6/core` `^6.5.3`, but npm's current release is 8.3.0. This ticket does not change the example.
