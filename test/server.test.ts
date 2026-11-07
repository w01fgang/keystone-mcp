import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphQLError, locatedError } from 'graphql';
import { buildCatalog } from '../src/catalog.js';
import { buildInstructions } from '../src/instructions.js';
import { createMcpServer, MAX_SELECT_PATHS } from '../src/server.js';
import type { McpContext } from '../src/types.js';
import { fakeContext, schema } from './schema.js';

async function connect(context: McpContext, queriesOnly = false, introspection = true) {
  const catalog = buildCatalog(schema, { queriesOnly });
  const instructions = buildInstructions(catalog, { introspection });
  const server = createMcpServer({ catalog, context, takeLimit: 50, introspection, instructions });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const text = (result: unknown) => (result as CallToolResult).content.map((part) => (part.type === 'text' ? part.text : '')).join('');

describe('createMcpServer', () => {
  it('offers exactly searchTool and callTool', async () => {
    const client = await connect(fakeContext().requestContext);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['searchTool', 'callTool']);
  });

  it.each([true, false])('names no technology in the text the agent reads, with introspection %s', async (introspection) => {
    const client = await connect(fakeContext().requestContext, false, introspection);
    const { tools } = await client.listTools();
    const search = await client.callTool({ name: 'searchTool', arguments: { text: 'post' } });
    // The search result itself is catalog data; only the off message is text of this package.
    const texts = [client.getInstructions(), JSON.stringify(tools), introspection ? '' : text(search)];
    for (const agentText of texts) expect(agentText).not.toMatch(/keystone|graphql|prisma/i);
  });

  it('searchTool returns the posts operation with its signatures and paths', async () => {
    const client = await connect(fakeContext().requestContext);
    const result = await client.callTool({ name: 'searchTool', arguments: { text: 'posts' } });
    const [posts] = JSON.parse(text(result)).operations;
    expect(posts).toMatchObject({ name: 'posts', kind: 'query', returnType: '[Post!]' });
    expect(posts.args[0]).toMatchObject({ name: 'where', type: 'PostWhereInput!', defaultValue: '{}' });
    expect(posts.paths).toContain('author.name');
  });

  it('searchTool rejects a limit above 25', async () => {
    const client = await connect(fakeContext().requestContext);
    const result = await client.callTool({ name: 'searchTool', arguments: { text: 'posts', limit: 26 } });
    expect(result.isError).toBe(true);
  });

  it('callTool refuses more select paths than the limit before it runs the operation', async () => {
    const { requestContext, runs } = fakeContext();
    const client = await connect(requestContext);
    const select = Array.from({ length: MAX_SELECT_PATHS + 1 }, () => 'id');
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'posts', select } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('select');
    expect(runs).toEqual([]);
  });

  it('callTool runs the document with take clamped to 50 and returns the data', async () => {
    const { requestContext, runs } = fakeContext();
    const client = await connect(requestContext);
    const result = await client.callTool({
      name: 'callTool',
      arguments: { operation: 'posts', args: { take: 80 }, select: ['id', 'author.name'] },
    });
    expect(result.isError).toBeFalsy();
    expect(runs).toEqual([
      { query: 'query KeystoneMcpCall($take: Int) { posts(take: $take) { id author { name } } }', variables: { take: 50 } },
    ]);
    const data = JSON.parse(text(result));
    expect(data.posts).toHaveLength(50);
    expect(data.posts[0]).toEqual({ id: '1', author: { name: 'Ada' } });
  });

  it('callTool returns a tool error that names searchTool for an unknown operation', async () => {
    const { requestContext, runs } = fakeContext();
    const client = await connect(requestContext);
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'invoices' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('searchTool');
    expect(runs).toEqual([]);
  });

  /** Runs `createPost` on a context whose `graphql.run` rejects the way Keystone's `run` does: with the first GraphQL error. */
  async function callCreatePostRejectingWith(error: unknown) {
    const context: McpContext = { ...fakeContext().requestContext, graphql: { schema, run: () => Promise.reject(error) } };
    const client = await connect(context);
    return client.callTool({ name: 'callTool', arguments: { operation: 'createPost', args: { data: { title: 'x' } }, select: ['id'] } });
  }

  afterEach(() => vi.restoreAllMocks());

  const prismaError = Object.assign(new Error('Invalid `prisma.post.create()` invocation: Unique constraint failed on the fields: (`title`)'), {
    name: 'PrismaClientKnownRequestError',
  });
  const ksError = (code: string, message: string, debug?: { message: string }[]) => new GraphQLError(message, { extensions: { code, debug } });
  const SERVER_ERROR = "The server could not run this operation. The app's owner can find the cause in the server log.";

  // Each error carries a technology word in its message, so a kept message would fail the check below.
  it.each([
    ['KS_ACCESS_DENIED', ksError('KS_ACCESS_DENIED', 'Access denied: You cannot create that Post'), 'ACCESS_DENIED'],
    ['KS_FILTER_DENIED', ksError('KS_FILTER_DENIED', `You do not have access to perform 'filter' operations on the fields ["keystone"].`), 'ACCESS_DENIED'],
    ['KS_USER_INPUT_ERROR', ksError('KS_USER_INPUT_ERROR', 'Input error: GraphQL input is wrong'), 'INVALID_INPUT'],
    ['KS_VALIDATION_FAILURE', ksError('KS_VALIDATION_FAILURE', 'You provided invalid data for this operation.\n  - Post.title: Prisma said no'), 'INVALID_INPUT'],
    ['KS_LIMITS_EXCEEDED', ksError('KS_LIMITS_EXCEEDED', 'Your request exceeded server limits'), 'INVALID_INPUT'],
    ['KS_EXTENSION_ERROR', ksError('KS_EXTENSION_ERROR', 'An error occurred while running "beforeOperation".\n  - Post: Keystone', [{ message: 'Keystone' }]), 'SERVER_ERROR'],
    ['KS_RESOLVER_ERROR', ksError('KS_RESOLVER_ERROR', 'An error occurred while resolving input fields.\n  - Post.title: prisma', [{ message: 'prisma' }]), 'SERVER_ERROR'],
    ['KS_RELATIONSHIP_ERROR', ksError('KS_RELATIONSHIP_ERROR', 'An error occurred while resolving relationship fields.\n  - Post.author: Prisma error', [{ message: 'Prisma error' }]), 'SERVER_ERROR'],
    ['KS_ACCESS_RETURN_ERROR', ksError('KS_ACCESS_RETURN_ERROR', 'Invalid values returned from access control function.'), 'SERVER_ERROR'],
    ['KS_PRISMA_ERROR', ksError('KS_PRISMA_ERROR', 'Prisma error: Unique constraint failed on the fields: (`slug`)'), 'SERVER_ERROR'],
    ['an unknown code', ksError('APP_CODE', 'GraphQL says no'), 'SERVER_ERROR'],
    ['a database error without a code', locatedError(prismaError, undefined, ['createPost']), 'SERVER_ERROR'],
    ['a resolver error without a code', locatedError(new Error('Title is reserved'), undefined, ['createPost']), 'SERVER_ERROR'],
    ['a value that is not an error', 'keystone', 'SERVER_ERROR'],
  ])('callTool gives %s a neutral code and no technology word', async (_, error, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await callCreatePostRejectingWith(error);
    expect(result.isError).toBe(true);
    expect(text(result)).not.toMatch(/keystone|graphql|prisma|"KS_/i);
    expect(JSON.parse(text(result)).errors[0].extensions).toEqual({ code });
  });

  it('callTool keeps an access-denied message and does not log it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await callCreatePostRejectingWith(ksError('KS_ACCESS_DENIED', 'Access denied: You cannot create that Post'));
    expect(JSON.parse(text(result))).toEqual({
      errors: [{ message: 'Access denied: You cannot create that Post', extensions: { code: 'ACCESS_DENIED' } }],
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('callTool replaces a database error with the fixed sentence and logs the original error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = locatedError(prismaError, undefined, ['createPost']);
    const result = await callCreatePostRejectingWith(error);
    expect(JSON.parse(text(result))).toEqual({ errors: [{ message: SERVER_ERROR, extensions: { code: 'SERVER_ERROR' } }] });
    expect(log).toHaveBeenCalledWith('keystone-mcp: callTool "createPost" failed:', error);
  });

  it('callTool gives a list of field errors the code of its errors only when all of them share it', async () => {
    const denied = 'Access denied: You cannot connect that User - it may not exist';
    const relationship = (messages: string[]) =>
      ksError('KS_RELATIONSHIP_ERROR', `An error occurred while resolving relationship fields.\n  - Post.author: ${messages.join(', ')}`,
        messages.map((message) => ({ message })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const allDenied = JSON.parse(text(await callCreatePostRejectingWith(relationship([denied, denied]))));
    const mixed = JSON.parse(text(await callCreatePostRejectingWith(relationship([denied, 'Input error: no id']))));
    expect(allDenied.errors[0]).toEqual({ message: expect.stringContaining(denied), extensions: { code: 'ACCESS_DENIED' } });
    expect(mixed.errors[0]).toEqual({ message: SERVER_ERROR, extensions: { code: 'SERVER_ERROR' } });
  });

  it('callTool gives an argument of the wrong type the code INVALID_INPUT and names the argument', async () => {
    const client = await connect(fakeContext().requestContext);
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'posts', args: { take: 'many' }, select: ['id'] } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result))).toEqual({
      errors: [{ message: 'Argument "take" got invalid value "many"; Int cannot represent non-integer value: "many"', extensions: { code: 'INVALID_INPUT' } }],
    });
  });

  it('callTool gives an input that the catalog rejects the code INVALID_INPUT', async () => {
    const client = await connect(fakeContext().requestContext);
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'posts', args: { first: 1 } } });
    expect(JSON.parse(text(result)).errors[0]).toEqual({ message: expect.stringContaining('"first"'), extensions: { code: 'INVALID_INPUT' } });
  });

  it('callTool cannot run a mutation when queriesOnly is set', async () => {
    const client = await connect(fakeContext().requestContext, true);
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'createPost', args: { data: {} } } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result)).errors[0].message).toContain('Unknown operation "createPost"');
  });
});
