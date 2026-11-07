# F006 notes

## Field types the suite does not exercise

- `decimal`: Keystone 8.3.0 throws `The decimal field does not support sqlite` when the field is built on SQLite (`packages/core/src/fields/types/decimal/index.ts`). The suite runs on SQLite with no network, so it has no PostgreSQL or MySQL database for this field. `Decimal` values travel as strings, like `bigInt`, which the suite does exercise.

## Partly exercised, by the ticket's scope

- `file`, `image`, `cloudinaryImage`: the test stores the item through Prisma, then reads, filters, updates and deletes it through `callTool`. No upload goes through `callTool`, and nothing calls Cloudinary.

## Limits of the package that the suite pins

- The catalog summary of a `where` argument leaves out to-many relationship filters (`every`, `some`, `none`), by the catalog rule of the first version of the package (F001). `callTool` still runs such a filter; the relationship test proves it.
- A field whose argument is required and has no default (the `excerpt` virtual field in the test app) is not a selectable path, so `callTool` cannot read it. A virtual field whose arguments have defaults is readable with those defaults.
- A unique-constraint conflict is a database error, so `callTool` answers `SERVER_ERROR` with the fixed sentence, by the rule that the agent never reads a database message (F005). The agent does not learn which value was a duplicate.

## Seams

- Test app: `test/keystone/keystone.ts`. `beforeAll` in `test/fields.test.ts` runs `keystone build --no-ui` in that folder, then `prisma db push` into a temporary SQLite file, and loads `.keystone/config.js` and `.keystone/prisma.js`, as `keystone start` does. The build output is ignored by `test/keystone/.gitignore`.
- Keystone loads `graphql/index.js`, the CommonJS build. Node resolves a bare `graphql` import to the same file, but Vite picks `index.mjs` from the `module` field, which creates a second graphql and fails Keystone's schema checks. `vitest.config.ts` aliases `graphql` to `graphql/index.js`. This is a test-runner effect, not a package defect: the built package under plain Node, ESM and CommonJS, shares Keystone's graphql.
