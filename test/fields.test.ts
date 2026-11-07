import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getContext } from '@keystone-6/core/context';
import type { KeystoneContext } from '@keystone-6/core/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildCatalog } from '../src/catalog.js';
import { keystoneMcp } from '../src/mount.js';
import { createMcpServer } from '../src/server.js';
import type { CatalogEntry, InputSummary, JsonObject, JsonValue } from '../src/types.js';
import { signIn } from './oauth.js';

/**
 * The tool flow of `/mcp` against a real Keystone app (`test/keystone/keystone.ts`) with one list for each field type.
 * `beforeAll` builds the app as `keystone build` does, creates a fresh SQLite database, and signs in through OAuth.
 */

const appDir = fileURLToPath(new URL('./keystone/', import.meta.url));
const run = promisify(execFile);
const USER = { email: 'ada@example.com', password: 'a long test password' };
const TECHNOLOGY = /keystone|graphql|prisma/i;

let context: KeystoneContext;
let server: Server;
let client: Client;
let databaseDir: string;
let userId: string;

beforeAll(async () => {
  databaseDir = await mkdtemp(join(tmpdir(), 'keystone-mcp-fields-'));

  const env = {
    ...process.env,
    DATABASE_URL: `file:${join(databaseDir, 'test.db')}`,
    KEYSTONE_TELEMETRY_DISABLED: '1',
    CHECKPOINT_DISABLE: '1',
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
  };

  process.env.DATABASE_URL = env.DATABASE_URL;
  const require = createRequire(join(appDir, 'package.json'));
  await run(process.execPath, [require.resolve('@keystone-6/core/bin/cli.js'), 'build', '--no-ui', '--quiet'], { cwd: appDir, env });
  await run(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--schema', 'schema.prisma'], { cwd: appDir, env });
  // The same two modules that `keystone start` loads.
  // SAFETY: `keystone build` above succeeded, so `.keystone/config.js` is keystone.ts compiled, and its default export is `config()`.
  const config = require('./.keystone/config.js').default as Parameters<typeof getContext>[0];
  const prismaModule: unknown = require('./.keystone/prisma.js');
  context = getContext(config, prismaModule);
  userId = String((await context.sudo().db.User.createOne({ data: { name: 'Ada', ...USER } })).id);

  const app = express();
  keystoneMcp()(app, context);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  // SAFETY: the server listens on a TCP host and port, and `listening` has fired, so `address()` is an `AddressInfo`.
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { accessToken } = await signIn(base, '/mcp', USER);
  client = new Client({ name: 'test', version: '1.0.0' });
  const headers = { Authorization: `Bearer ${accessToken}` };
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
}, 120_000);

afterAll(async () => {
  await client?.close();

  if (server) await once(server.close(), 'close');
  await context?.prisma.$disconnect();

  if (databaseDir) await rm(databaseDir, { recursive: true, force: true });
});

/** Runs one tool and checks that its text names no technology. */
async function runTool(agent: Client, name: string, args: JsonObject) {
  const result = CallToolResultSchema.parse(await agent.callTool({ name, arguments: args }));
  const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
  expect(text).not.toMatch(TECHNOLOGY);

  return { isError: Boolean(result.isError), text };
}

/** An argument or input field as searchTool lists it. */
const inputSummary: z.ZodType<InputSummary> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    description: z.string().optional(),
    defaultValue: z.string().optional(),
    fields: z.array(inputSummary).optional(),
  }),
);

/** The text of a searchTool result. */
const searchResult = z.object({
  operations: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(['query', 'mutation']),
      description: z.string().optional(),
      returnType: z.string(),
      args: z.array(inputSummary),
      paths: z.array(z.string()),
      leaf: z.boolean(),
    }),
  ),
});

async function search(text: string): Promise<CatalogEntry[]> {
  const result = await runTool(client, 'searchTool', { text, limit: 25 });
  expect(result.isError).toBe(false);

  return searchResult.parse(JSON.parse(result.text)).operations;
}

/** Finds an operation through searchTool, as an agent does. */
async function find(operation: string): Promise<CatalogEntry> {
  const entry = (await search(operation)).find((candidate) => candidate.name === operation);

  if (!entry) throw new Error(`searchTool did not find ${operation}`);

  return entry;
}

type Row = JsonObject;

/** The text of a successful callTool result: the data of each operation by name. */
const callResult = z.record(z.string(), z.json());

/** The data of an operation that returns one item, or `null` when it finds none. */
const oneItem = z.record(z.string(), z.json()).nullable();

/** The data of a list query that selects `id`. */
const itemIds = z.array(z.object({ id: z.string() }));

/** The text of a failed callTool result. */
const callFailure = z.object({
  errors: z.array(z.looseObject({ message: z.string(), extensions: z.looseObject({ code: z.string() }) })),
});

/** Runs callTool and returns the data of the operation. */
async function callData(operation: string, args: Row, select?: string[]): Promise<JsonValue> {
  const result = await runTool(client, 'callTool', select ? { operation, args, select } : { operation, args });

  if (result.isError) throw new Error(`callTool ${operation} failed: ${result.text}`);

  return callResult.parse(JSON.parse(result.text))[operation] ?? null;
}

/** Runs callTool for an operation that returns one item. */
async function call(operation: string, args: Row, select?: string[]): Promise<Row | null> {
  return oneItem.parse(await callData(operation, args, select));
}

async function callError(operation: string, args: Row, select = ['id']) {
  const result = await runTool(client, 'callTool', { operation, args, select });
  expect(result.isError).toBe(true);

  return callFailure.parse(JSON.parse(result.text)).errors[0];
}

/** The ids of the items of a list query that match a filter. */
async function idsOf(operation: string, where: Row): Promise<string[]> {
  return itemIds.parse(await callData(operation, { where }, ['id'])).map((item) => item.id);
}

/** The names of the input fields of an argument in a catalog entry, for example the fields of `data`. */
function inputFields(entry: CatalogEntry, arg: string): string[] {
  return entry.args.find((candidate) => candidate.name === arg)?.fields?.map((field) => field.name) ?? [];
}

const lowerFirst = (name: string) => name[0]!.toLowerCase() + name.slice(1);

interface RoundTrip {
  list: string;
  /** Paths that the reads select. */
  select: string[];
  /** The data of the create call. Without it, the item is `stored` in the database before the flow starts. */
  create?: Row;
  stored?: () => Promise<{ id: string }>;
  /** The values that the reads return after the create. */
  created: Row;
  /** A filter that matches the created item. `NOT` of it must not match. Omitted where Keystone offers no filter. */
  filter?: Row;
  update: Row;
  updated: Row;
}

/**
 * The whole tool flow for one list: searchTool finds each operation, callTool creates the item and reads it back,
 * filters for it, updates it and deletes it.
 */
async function roundTrip({ list, select, create, stored, created, filter, update, updated }: RoundTrip) {
  const one = lowerFirst(list);
  const many = `${one}s`;
  const read = await find(one);

  for (const path of select) expect(read.paths).toContain(path);

  let id: string;

  if (create) {
    expect(inputFields(await find(`create${list}`), 'data')).toEqual(expect.arrayContaining(Object.keys(create)));
    const item = await call(`create${list}`, { data: create }, ['id', ...select]);
    expect(item).toMatchObject(created);
    id = z.string().parse(item?.id);
  } else {
    id = (await stored!()).id;
  }

  expect(await call(one, { where: { id } }, select)).toMatchObject(created);

  if (filter) {
    expect(inputFields(await find(many), 'where')).toEqual(expect.arrayContaining(Object.keys(filter)));
    expect(await idsOf(many, filter)).toContain(id);
    expect(await idsOf(many, { NOT: [filter] })).not.toContain(id);
  }

  expect(inputFields(await find(`update${list}`), 'data')).toEqual(expect.arrayContaining(Object.keys(update)));
  expect(await call(`update${list}`, { where: { id }, data: update }, select)).toMatchObject(updated);
  expect(await call(one, { where: { id } }, select)).toMatchObject(updated);

  expect(await call(`delete${list}`, { where: { id } }, ['id'])).toEqual({ id });
  expect(await call(one, { where: { id } }, ['id'])).toBeNull();
}

describe('every Keystone field type through searchTool and callTool', () => {
  it('stores text fields that are required, nullable and defaulted, and filters on them', async () => {
    await roundTrip({
      list: 'TextItem',
      select: ['required', 'nullable', 'withDefault'],
      create: { required: 'Hello World' },
      created: { required: 'Hello World', nullable: null, withDefault: 'hello' },
      filter: { required: { contains: 'lo Wo' } },
      update: { nullable: 'set', withDefault: 'changed' },
      updated: { required: 'Hello World', nullable: 'set', withDefault: 'changed' },
    });
  });

  it('refuses an empty required text with INVALID_INPUT and names the field', async () => {
    const error = await callError('createTextItem', { data: { required: '' } });
    expect(error.extensions.code).toBe('INVALID_INPUT');
    expect(error.message).toContain('required');
  });

  it('stores checkbox fields with their defaults and filters on them', async () => {
    await roundTrip({
      list: 'CheckboxItem',
      select: ['value', 'withDefault'],
      create: { value: true },
      created: { value: true, withDefault: true },
      filter: { value: { equals: true } },
      update: { value: false, withDefault: false },
      updated: { value: false, withDefault: false },
    });
  });

  it('stores integer fields that are required, defaulted and non-nullable, and filters on them', async () => {
    await roundTrip({
      list: 'IntegerItem',
      select: ['required', 'withDefault', 'nonNullable'],
      create: { required: 3 },
      created: { required: 3, withDefault: 7, nonNullable: 0 },
      filter: { required: { gt: 2 } },
      update: { required: 4, withDefault: null },
      updated: { required: 4, withDefault: null },
    });
  });

  it('refuses a string for an integer with INVALID_INPUT and names the argument', async () => {
    const error = await callError('createIntegerItem', { data: { required: 'three' } });
    expect(error.extensions.code).toBe('INVALID_INPUT');
    expect(error.message).toMatch(/^Argument "data"/);
  });

  it('stores bigInt fields as strings beyond the safe integer range, and filters on them', async () => {
    await roundTrip({
      list: 'BigIntItem',
      select: ['required', 'withDefault'],
      create: { required: '9007199254740995' },
      created: { required: '9007199254740995', withDefault: '9007199254740993' },
      filter: { required: { gte: '9007199254740994' } },
      update: { required: '-12' },
      updated: { required: '-12' },
    });
  });

  it('stores float fields with their defaults and filters on them', async () => {
    await roundTrip({
      list: 'FloatItem',
      select: ['required', 'withDefault'],
      create: { required: 2.25 },
      created: { required: 2.25, withDefault: 1.5 },
      filter: { required: { lt: 2.5 } },
      update: { required: 3.75 },
      updated: { required: 3.75 },
    });
  });

  it('stores bytes fields as hexadecimal text and filters on them', async () => {
    await roundTrip({
      list: 'BytesItem',
      select: ['value', 'required'],
      create: { value: 'cafe', required: '00ff' },
      created: { value: 'cafe', required: '00ff' },
      filter: { value: { equals: 'cafe' } },
      update: { value: null },
      updated: { value: null, required: '00ff' },
    });
  });

  it('stores calendarDay fields as dates and filters on them', async () => {
    await roundTrip({
      list: 'CalendarDayItem',
      select: ['value', 'withDefault'],
      create: { value: '2026-11-07' },
      created: { value: '2026-11-07', withDefault: '2026-01-01' },
      filter: { value: { gte: '2026-11-01' } },
      update: { value: '2027-02-28' },
      updated: { value: '2027-02-28' },
    });
  });

  it('stores timestamp fields with a now default and an updatedAt time, and filters on them', async () => {
    const before = new Date().toISOString();
    await roundTrip({
      list: 'TimestampItem',
      select: ['value', 'createdAt', 'updatedAt'],
      create: { value: '2026-11-07T10:00:00.000Z' },
      created: { value: '2026-11-07T10:00:00.000Z', createdAt: expect.any(String), updatedAt: expect.any(String) },
      filter: { value: { gt: '2026-11-07T09:00:00.000Z' }, createdAt: { gte: before } },
      update: { value: null },
      updated: { value: null },
    });
  });

  it('stores json fields as values and offers no filter on them', async () => {
    await roundTrip({
      list: 'JsonItem',
      select: ['value', 'withDefault'],
      create: { value: { a: [1, 'two', null] } },
      created: { value: { a: [1, 'two', null] }, withDefault: { tags: [] } },
      update: { value: 'text', withDefault: null },
      updated: { value: 'text', withDefault: null },
    });
    expect(inputFields(await find('jsonItems'), 'where')).toEqual(['id']);
  });

  it('stores select fields of string, integer and enum type, and filters on them', async () => {
    const create = await find('createSelectItem');
    const data = create.args.find((arg) => arg.name === 'data')!.fields!;
    expect(data.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: 'status', type: 'String' },
      { name: 'priority', type: 'Int' },
      { name: 'kind', type: 'SelectItemKindType' },
    ]);
    await roundTrip({
      list: 'SelectItem',
      select: ['status', 'priority', 'kind'],
      create: { priority: 2, kind: 'video' },
      created: { status: 'draft', priority: 2, kind: 'video' },
      filter: { status: { equals: 'draft' }, priority: { in: [2] }, kind: { equals: 'video' } },
      update: { status: 'published', priority: null, kind: 'article' },
      updated: { status: 'published', priority: null, kind: 'article' },
    });
  });

  it('refuses a select value outside its options with INVALID_INPUT', async () => {
    const string = await callError('createSelectItem', { data: { status: 'archived', kind: 'video' } });
    expect(string.extensions.code).toBe('INVALID_INPUT');
    const enumValue = await callError('createSelectItem', { data: { kind: 'podcast' } });
    expect(enumValue.extensions.code).toBe('INVALID_INPUT');
    expect(enumValue.message).toMatch(/^Argument "data"/);
  });

  it('stores multiselect fields of string, integer and enum type, and offers no filter on them', async () => {
    await roundTrip({
      list: 'MultiselectItem',
      select: ['colors', 'sizes', 'symbols'],
      create: { colors: ['red', 'blue'], sizes: [2], symbols: ['circle'] },
      created: { colors: ['red', 'blue'], sizes: [2], symbols: ['circle'] },
      update: { colors: [], sizes: [1, 2], symbols: ['square', 'circle'] },
      updated: { colors: [], sizes: [1, 2], symbols: ['square', 'circle'] },
    });
    expect(inputFields(await find('multiselectItems'), 'where')).toEqual(['id']);
  });

  it('stores a password and reads only whether it is set', async () => {
    await roundTrip({
      list: 'User',
      select: ['email', 'password.isSet'],
      create: { email: 'grace@example.com', password: 'another long password' },
      created: { email: 'grace@example.com', password: { isSet: true } },
      filter: { email: { equals: 'grace@example.com' } },
      update: { password: 'a changed long password' },
      updated: { password: { isSet: true } },
    });
    expect(await find('user')).toMatchObject({ paths: expect.not.arrayContaining(['password']) });
  });

  it('refuses a short password with INVALID_INPUT', async () => {
    const error = await callError('createUser', { data: { email: 'short@example.com', password: 'short' } });
    expect(error.extensions.code).toBe('INVALID_INPUT');
  });

  it('refuses a duplicate unique text with SERVER_ERROR and without the database message', async () => {
    const error = await callError('createUser', { data: { email: USER.email, password: 'yet another long password' } });
    expect(error).toEqual({
      message: "The server could not run this operation. The app's owner can find the cause in the server log.",
      extensions: { code: 'SERVER_ERROR' },
    });
  });

  it('connects one-sided and two-sided relationships, to one and to many, and filters on them', async () => {
    const parent = await call('createRelationshipItem', { data: { name: 'parent' } }, ['id']);
    const tag = await call('createTag', { data: { name: 'red' } }, ['id']);

    const sibling = await call(
      'createRelationshipItem',
      { data: { name: 'sibling', parent: { connect: { id: parent!.id } }, tags: { create: [{ name: 'green' }] } } },
      ['id'],
    );

    // The catalog summary leaves out filters on to-many relationships, but callTool runs them.
    expect(inputFields(await find('relationshipItems'), 'where')).toEqual(['id', 'name', 'owner', 'parent']);
    expect(await idsOf('relationshipItems', { tags: { some: { name: { equals: 'green' } } } })).toEqual([sibling!.id]);
    expect(await idsOf('relationshipItems', { children: { some: { name: { equals: 'sibling' } } } })).toEqual([parent!.id]);

    await roundTrip({
      list: 'RelationshipItem',
      select: ['name', 'owner.email', 'tags.name', 'tagsCount', 'parent.name'],
      create: {
        name: 'child',
        owner: { connect: { id: userId } },
        tags: { connect: [{ id: tag!.id }], create: [{ name: 'blue' }] },
        parent: { connect: { id: parent!.id } },
      },
      created: {
        name: 'child',
        owner: { email: USER.email },
        tags: expect.arrayContaining([{ name: 'red' }, { name: 'blue' }]),
        tagsCount: 2,
        parent: { name: 'parent' },
      },
      filter: { owner: { id: { equals: userId } }, parent: { name: { equals: 'parent' } } },
      update: { owner: { disconnect: true }, tags: { set: [{ id: tag!.id }] } },
      updated: { owner: null, tags: [{ name: 'red' }], tagsCount: 1, parent: { name: 'parent' } },
    });
    // The other side of the two-sided relationship lost the deleted child and kept the sibling.
    const other = await call('relationshipItem', { where: { id: parent!.id } }, ['childrenCount', 'children.name']);
    expect(other).toEqual({ childrenCount: 1, children: [{ name: 'sibling' }] });
  });

  it('reads virtual fields with a defaulted argument and with an object type, and offers no write for them', async () => {
    const read = await find('virtualItem');
    expect(read.paths).toEqual(expect.arrayContaining(['greeting', 'stats.length', 'stats.upper']));
    // A field whose argument has no default cannot be selected: callTool passes arguments to the operation only.
    expect(read.paths).not.toContain('excerpt');
    expect(inputFields(await find('createVirtualItem'), 'data')).toEqual(['name']);
    await roundTrip({
      list: 'VirtualItem',
      select: ['name', 'greeting', 'stats.length', 'stats.upper'],
      create: { name: 'Ada' },
      created: { name: 'Ada', greeting: 'Hello, Ada.', stats: { length: 3, upper: 'ADA' } },
      filter: { name: { equals: 'Ada' } },
      update: { name: 'Grace' },
      updated: { greeting: 'Hello, Grace.', stats: { length: 5, upper: 'GRACE' } },
    });
  });

  it('reads a stored file with its name, size and url', async () => {
    expect(inputFields(await find('createFileItem'), 'data')).toEqual(['name', 'attachment']);
    await roundTrip({
      list: 'FileItem',
      select: ['name', 'attachment.filename', 'attachment.filesize', 'attachment.url'],
      stored: () => context.prisma.fileItem.create({ data: { name: 'report', attachment_filename: 'report.pdf', attachment_filesize: 1024 } }),
      created: { name: 'report', attachment: { filename: 'report.pdf', filesize: 1024, url: 'http://files.test/report.pdf' } },
      filter: { name: { equals: 'report' } },
      update: { name: 'renamed' },
      updated: { name: 'renamed', attachment: { filename: 'report.pdf' } },
    });
  });

  it('reads a stored image with its size, dimensions and url', async () => {
    expect(inputFields(await find('createImageItem'), 'data')).toEqual(['name', 'picture']);
    await roundTrip({
      list: 'ImageItem',
      select: ['name', 'picture.id', 'picture.extension', 'picture.filesize', 'picture.width', 'picture.height', 'picture.url'],
      stored: () =>
        context.prisma.imageItem.create({
          data: { name: 'cat', picture_id: 'cat1', picture_extension: 'png', picture_filesize: 2048, picture_width: 640, picture_height: 480 },
        }),
      created: {
        name: 'cat',
        picture: { id: 'cat1', extension: 'png', filesize: 2048, width: 640, height: 480, url: 'http://files.test/cat1.png' },
      },
      filter: { name: { equals: 'cat' } },
      update: { name: 'dog' },
      updated: { name: 'dog', picture: { id: 'cat1' } },
    });
  });

  it('stores a document and reads it back', async () => {
    const paragraph = (text: string) => [{ type: 'paragraph', children: [{ text }] }];
    await roundTrip({
      list: 'DocumentItem',
      select: ['content.document'],
      create: { content: paragraph('Hello') },
      created: { content: { document: paragraph('Hello') } },
      update: { content: paragraph('Changed') },
      updated: { content: { document: paragraph('Changed') } },
    });
    expect(inputFields(await find('documentItems'), 'where')).toEqual(['id']);
  });

  it('reads a stored cloudinaryImage with its url and metadata', async () => {
    expect(inputFields(await find('createCloudinaryItem'), 'data')).toEqual(['name', 'banner']);

    const banner = {
      id: 'b1',
      filename: 'banner.jpg',
      originalFilename: 'banner.jpg',
      mimetype: 'image/jpeg',
      encoding: '7bit',
      _meta: { public_id: 'banners/b1', format: 'jpg', width: 1200, height: 400, bytes: 4096, secure_url: 'https://res.cloudinary.com/test-cloud/b1.jpg' },
    };

    await roundTrip({
      list: 'CloudinaryItem',
      select: ['name', 'banner.filename', 'banner.mimetype', 'banner.publicUrl', 'banner.publicUrlTransformed', 'banner.filesize', 'banner.width'],
      stored: () => context.prisma.cloudinaryItem.create({ data: { name: 'hero', banner } }),
      created: {
        name: 'hero',
        banner: {
          filename: 'banner.jpg',
          mimetype: 'image/jpeg',
          publicUrl: banner._meta.secure_url,
          publicUrlTransformed: banner._meta.secure_url,
          filesize: 4096,
          width: 1200,
        },
      },
      filter: { name: { equals: 'hero' } },
      update: { name: 'renamed' },
      updated: { name: 'renamed', banner: { filename: 'banner.jpg' } },
    });
  });

  it('names no technology in the instructions and tool list of the app', async () => {
    expect(client.getInstructions()).toMatch(/^This project holds these kinds of records: /);
    const texts = [client.getInstructions(), JSON.stringify((await client.listTools()).tools)];

    for (const agentText of texts) expect(agentText).not.toMatch(TECHNOLOGY);
  });

  it('keeps the access of the session: an anonymous callTool cannot write', async () => {
    const catalog = buildCatalog(context.graphql.schema);
    const server = createMcpServer({ catalog, context, takeLimit: 50, introspection: true, instructions: '' });
    const anonymous = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), anonymous.connect(clientTransport)]);

    const write = await runTool(anonymous, 'callTool', { operation: 'createTextItem', args: { data: { required: 'x' } }, select: ['id'] });
    expect(write.isError).toBe(true);
    expect(JSON.parse(write.text).errors[0].extensions.code).toBe('ACCESS_DENIED');
    const read = await runTool(anonymous, 'callTool', { operation: 'textItemsCount', args: {} });
    expect(read.isError).toBe(false);
    expect(await context.sudo().db.TextItem.count({ where: { required: { equals: 'x' } } })).toBe(0);
    await anonymous.close();
  });
});
