import { config, g, list } from '@keystone-6/core';
import { allowAll } from '@keystone-6/core/access';
import {
  bigInt,
  bytes,
  calendarDay,
  checkbox,
  file,
  float,
  image,
  integer,
  json,
  multiselect,
  password,
  relationship,
  select,
  text,
  timestamp,
  virtual,
} from '@keystone-6/core/fields';
import { statelessSessions } from '@keystone-6/core/session';
import { createAuth } from '@keystone-6/auth';
import { cloudinaryImage } from '@keystone-6/cloudinary';
import { document } from '@keystone-6/fields-document';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

/**
 * A Keystone app with one list for each field type that Keystone ships, for the field-type tests in
 * `test/fields.test.ts`. Every list can be read by anyone and changed only by a signed-in user.
 * The `decimal` field is not here: Keystone does not support it on SQLite (see the feature's notes.md).
 */

const signedIn = ({ session }: { session?: unknown }) => session !== undefined;
const access = {
  operation: { query: allowAll, create: signedIn, update: signedIn, delete: signedIn },
};

/** Storage for file and image fields. The tests store items in the database only, so nothing is written. */
const storage = {
  async put() {
    throw new Error('The test app stores no file content.');
  },
  async delete() {},
  url: (key: string) => `http://files.test/${key}`,
};

const { withAuth } = createAuth({ listKey: 'User', identityField: 'email', secretField: 'password' });

export default withAuth(
  config({
    db: {
      provider: 'sqlite',
      prismaClientOptions: () => ({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? '' }) }),
    },
    ui: { isDisabled: true },
    session: statelessSessions({ secret: 'a test secret that is at least thirty-two characters long' }),
    lists: {
      User: list({
        access,
        fields: {
          name: text(),
          email: text({ isIndexed: 'unique', validation: { isRequired: true } }),
          password: password({ validation: { isRequired: true } }),
        },
      }),
      TextItem: list({
        access,
        fields: {
          required: text({ validation: { isRequired: true } }),
          nullable: text({ db: { isNullable: true } }),
          withDefault: text({ defaultValue: 'hello' }),
        },
      }),
      CheckboxItem: list({
        access,
        fields: { value: checkbox(), withDefault: checkbox({ defaultValue: true }) },
      }),
      IntegerItem: list({
        access,
        fields: {
          required: integer({ validation: { isRequired: true } }),
          withDefault: integer({ defaultValue: 7 }),
          nonNullable: integer({ db: { isNullable: false }, defaultValue: 0 }),
        },
      }),
      BigIntItem: list({
        access,
        fields: {
          required: bigInt({ validation: { isRequired: true } }),
          withDefault: bigInt({ defaultValue: 9007199254740993n }),
        },
      }),
      FloatItem: list({
        access,
        fields: { required: float({ validation: { isRequired: true } }), withDefault: float({ defaultValue: 1.5 }) },
      }),
      BytesItem: list({
        access,
        fields: { value: bytes(), required: bytes({ validation: { isRequired: true } }) },
      }),
      CalendarDayItem: list({
        access,
        fields: {
          value: calendarDay(),
          withDefault: calendarDay({ defaultValue: '2026-01-01', db: { isNullable: false } }),
        },
      }),
      TimestampItem: list({
        access,
        fields: {
          value: timestamp(),
          createdAt: timestamp({ defaultValue: { kind: 'now' } }),
          updatedAt: timestamp({ db: { updatedAt: true } }),
        },
      }),
      JsonItem: list({
        access,
        fields: { value: json(), withDefault: json({ defaultValue: { tags: [] } }) },
      }),
      SelectItem: list({
        access,
        fields: {
          status: select({ options: ['draft', 'published'], defaultValue: 'draft' }),
          priority: select({
            type: 'integer',
            options: [
              { label: 'Low', value: 1 },
              { label: 'High', value: 2 },
            ],
          }),
          kind: select({ type: 'enum', options: ['article', 'video'], validation: { isRequired: true } }),
        },
      }),
      MultiselectItem: list({
        access,
        fields: {
          colors: multiselect({ options: ['red', 'green', 'blue'] }),
          sizes: multiselect({
            type: 'integer',
            options: [
              { label: 'Small', value: 1 },
              { label: 'Large', value: 2 },
            ],
          }),
          shapes: multiselect({ type: 'enum', options: ['circle', 'square'] }),
        },
      }),
      Tag: list({ access, fields: { name: text() } }),
      RelationshipItem: list({
        access,
        fields: {
          name: text(),
          owner: relationship({ ref: 'User' }),
          tags: relationship({ ref: 'Tag', many: true }),
          parent: relationship({ ref: 'RelationshipItem.children' }),
          children: relationship({ ref: 'RelationshipItem.parent', many: true }),
        },
      }),
      VirtualItem: list({
        access,
        fields: {
          name: text(),
          greeting: virtual({
            field: g.field({
              type: g.String,
              args: { excited: g.arg({ type: g.nonNull(g.Boolean), defaultValue: false }) },
              resolve: (item: { name: string }, { excited }) => `Hello, ${item.name}${excited ? '!' : '.'}`,
            }),
          }),
          excerpt: virtual({
            field: g.field({
              type: g.String,
              args: { length: g.arg({ type: g.nonNull(g.Int) }) },
              resolve: (item: { name: string }, { length }) => item.name.slice(0, length),
            }),
            ui: { query: '(length: 3)' },
          }),
          stats: virtual({
            field: g.field({
              type: g.object<{ length: number; upper: string }>()({
                name: 'VirtualItemStats',
                fields: { length: g.field({ type: g.Int }), upper: g.field({ type: g.String }) },
              }),
              resolve: (item: { name: string }) => ({ length: item.name.length, upper: item.name.toUpperCase() }),
            }),
            ui: { query: '{ length upper }' },
          }),
        },
      }),
      FileItem: list({ access, fields: { name: text(), attachment: file({ storage }) } }),
      ImageItem: list({ access, fields: { name: text(), picture: image({ storage }) } }),
      DocumentItem: list({
        access,
        fields: { content: document({ formatting: true, links: true }) },
      }),
      CloudinaryItem: list({
        access,
        fields: {
          name: text(),
          banner: cloudinaryImage({
            cloudinary: { cloudName: 'test-cloud', apiKey: 'test-key', apiSecret: 'test-secret', folder: 'banners' },
          }),
        },
      }),
    },
  }),
);
