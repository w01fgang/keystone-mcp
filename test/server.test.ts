import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { GraphQLError, locatedError } from 'graphql';
import { buildCatalog } from '../src/catalog.js';
import { buildInstructions } from '../src/instructions.js';
import { createMcpServer } from '../src/server.js';
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
  async function callCreatePostRejectingWith(error: Error) {
    const context: McpContext = { ...fakeContext().requestContext, graphql: { schema, run: () => Promise.reject(error) } };
    const client = await connect(context);
    return client.callTool({ name: 'callTool', arguments: { operation: 'createPost', args: { data: { title: 'x' } }, select: ['id'] } });
  }

  it('callTool hides a Prisma error as "Prisma error" with code KS_PRISMA_ERROR, as /api/graphql does', async () => {
    const prismaError = Object.assign(new Error('Invalid `prisma.post.create()` invocation: Unique constraint failed on the fields: (`title`)'), {
      name: 'PrismaClientKnownRequestError',
    });
    const result = await callCreatePostRejectingWith(locatedError(prismaError, undefined, ['createPost']));
    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result))).toEqual({ errors: [{ message: 'Prisma error', extensions: { code: 'KS_PRISMA_ERROR' } }] });
  });

  it('callTool keeps the message and code of a Keystone error', async () => {
    const accessError = new GraphQLError('Access denied: You cannot create that Post', { extensions: { code: 'KS_ACCESS_DENIED' } });
    const result = await callCreatePostRejectingWith(accessError);
    expect(JSON.parse(text(result))).toEqual({
      errors: [{ message: 'Access denied: You cannot create that Post', extensions: { code: 'KS_ACCESS_DENIED' } }],
    });
  });

  it('callTool gives a resolver error without a code the code INTERNAL_SERVER_ERROR', async () => {
    const result = await callCreatePostRejectingWith(locatedError(new Error('Title is reserved'), undefined, ['createPost']));
    expect(JSON.parse(text(result))).toEqual({ errors: [{ message: 'Title is reserved', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] });
  });

  it('callTool gives an argument of the wrong type the code BAD_USER_INPUT', async () => {
    const client = await connect(fakeContext().requestContext);
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'posts', args: { take: 'many' }, select: ['id'] } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result))).toEqual({
      errors: [{ message: 'Variable "$take" got invalid value "many"; Int cannot represent non-integer value: "many"', extensions: { code: 'BAD_USER_INPUT' } }],
    });
  });

  it('callTool cannot run a mutation when queriesOnly is set', async () => {
    const client = await connect(fakeContext().requestContext, true);
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'createPost', args: { data: {} } } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Unknown operation "createPost"');
  });
});
