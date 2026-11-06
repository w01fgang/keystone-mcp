import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../src/catalog.js';
import { createMcpServer } from '../src/server.js';
import type { McpContext } from '../src/types.js';
import { fakeContext, schema } from './schema.js';

async function connect(context: McpContext, queriesOnly = false) {
  const server = createMcpServer({ catalog: buildCatalog(schema, { queriesOnly }), context, takeLimit: 50 });
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

  it('callTool returns a tool error when graphql.run rejects', async () => {
    const context: McpContext = {
      ...fakeContext().requestContext,
      graphql: { schema, run: () => Promise.reject(new Error('Access denied: You cannot create that Post')) },
    };
    const client = await connect(context);
    const result = await client.callTool({
      name: 'callTool',
      arguments: { operation: 'createPost', args: { data: { title: 'x' } }, select: ['id'] },
    });
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Access denied: You cannot create that Post' }] });
  });

  it('callTool cannot run a mutation when queriesOnly is set', async () => {
    const client = await connect(fakeContext().requestContext, true);
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'createPost', args: { data: {} } } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Unknown operation "createPost"');
  });
});
