import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keystoneMcp } from '../src/mount.js';
import { INSTRUCTIONS } from '../src/server.js';
import type { KeystoneMcpOptions } from '../src/types.js';
import { signIn } from './oauth.js';
import { fakeContext } from './schema.js';

const servers: Server[] = [];
afterEach(() => Promise.all(servers.splice(0).map((server) => once(server.close(), 'close'))));
afterEach(() => vi.unstubAllEnvs());

async function start(options?: KeystoneMcpOptions) {
  const fake = fakeContext();
  const app = express();
  keystoneMcp(options)(app, fake.commonContext);
  app.post('/echo', (req, res) => res.json({ body: req.body ?? null }));
  const server = app.listen(0);
  await once(server, 'listening');
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { ...fake, base };
}

/** Signs in through the OAuth flow and connects with the access token. */
async function connect(base: string, path = '/mcp') {
  const { accessToken } = await signIn(base, path);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const headers = { Authorization: `Bearer ${accessToken}` };
  await client.connect(new StreamableHTTPClientTransport(new URL(base + path), { requestInit: { headers } }));
  return client;
}

describe('keystoneMcp', () => {
  it('answers POST /mcp with searchTool and callTool, and initialize carries the instructions', async () => {
    const { base } = await start();
    const client = await connect(base);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['searchTool', 'callTool']);
    await client.close();
  });

  it('runs callTool as the Keystone session behind the access token, with take clamped to 50', async () => {
    const { base, runs, requests } = await start();
    const client = await connect(base);
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'posts', args: { take: 80 }, select: ['id'] } });
    expect(result.isError).toBeFalsy();
    expect(runs.at(-1)).toEqual({ query: 'query KeystoneMcpCall($take: Int) { posts(take: $take) { id } }', variables: { take: 50 } });
    expect(requests.at(-1)?.headers.authorization).toBe('Bearer keystone-session-1');
    await client.close();
  });

  it.each(['GET', 'DELETE'])('responds 405 to %s with JSON-RPC code -32000', async (method) => {
    const { base } = await start();
    const response = await fetch(`${base}/mcp`, { method });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  });

  it('parses JSON on the MCP path only', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    expect(await response.json()).toEqual({ body: null });
  });

  it('mounts at a custom path and passes takeLimit to callTool', async () => {
    const { base, runs } = await start({ path: '/ai', takeLimit: 3 });
    expect((await fetch(`${base}/mcp`, { method: 'GET' })).status).toBe(404);
    const client = await connect(base, '/ai');
    await client.callTool({ name: 'callTool', arguments: { operation: 'posts', select: ['id'] } });
    expect(runs.at(-1)?.variables).toEqual({ take: 3 });
    await client.close();
  });

  it('rejects an invalid path or takeLimit', () => {
    expect(() => keystoneMcp({ path: 'mcp' })).toThrow(/path must start/);
    expect(() => keystoneMcp({ takeLimit: 0 })).toThrow(/takeLimit/);
  });

  it.each([
    { nodeEnv: 'production', introspection: undefined, on: false },
    { nodeEnv: 'production', introspection: true, on: true },
    { nodeEnv: 'development', introspection: undefined, on: true },
    { nodeEnv: 'development', introspection: false, on: false },
  ])('with NODE_ENV=$nodeEnv and introspection $introspection, searchTool on is $on', async ({ nodeEnv, introspection, on }) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    const { base } = await start({ introspection });
    const client = await connect(base);
    const result = await client.callTool({ name: 'searchTool', arguments: { text: 'posts' } });
    const text = (result.content as { text: string }[])[0].text;
    if (on) {
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(text).operations[0].name).toBe('posts');
    } else {
      expect(result.isError).toBe(true);
      expect(text).toContain('keystoneMcp({ introspection: true })');
    }
    await client.close();
  });

  it('runs callTool while searchTool is off', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { base, runs } = await start();
    const client = await connect(base);
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'posts', args: { take: 2 }, select: ['id'] } });
    expect(result.isError).toBeFalsy();
    expect(runs.at(-1)?.variables).toEqual({ take: 2 });
    await client.close();
  });
});
