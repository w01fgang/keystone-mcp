import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keystoneMcp } from '../src/mount.js';
import type { KeystoneMcpOptions } from '../src/types.js';
import { signIn } from './oauth.js';
import { fakeContext } from './schema.js';

const servers: Server[] = [];

afterEach(() => Promise.all(servers.splice(0).map((server) => once(server.close(), 'close'))));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function start(options?: KeystoneMcpOptions) {
  const fake = fakeContext();
  const app = express();
  keystoneMcp(options)(app, fake.commonContext);
  app.post('/echo', (req, res) => res.json({ body: req.body ?? null }));
  // 127.0.0.1, as the base URL: on all interfaces another program could bind 127.0.0.1 on this port and take requests.
  const server = app.listen(0, '127.0.0.1');
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
  it('answers POST /mcp with searchTool and callTool, and initialize starts with the author paragraph', async () => {
    const { base } = await start({ instructions: '  A blog about cats.\n' });
    const client = await connect(base);
    expect(client.getInstructions()).toMatch(/^A blog about cats\.\n\nThis project holds these kinds of records: posts, users\./);
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
    // A hook tells an MCP call from other calls by context.req.
    expect(requests.at(-1)?.url).toBe('/mcp');
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

  it('rejects an invalid path, takeLimit or secret', () => {
    expect(() => keystoneMcp({ path: 'mcp' })).toThrow(/path must start/);
    expect(() => keystoneMcp({ takeLimit: 0 })).toThrow(/takeLimit/);
    expect(() => keystoneMcp({ secret: 'x'.repeat(31) })).toThrow(/secret must be a string of 32 characters or more/);
    expect(() => keystoneMcp({ secret: '' })).toThrow(/secret/);
    expect(() => keystoneMcp({ secret: 'x'.repeat(32) })).not.toThrow();
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
      expect(text).toContain("Ask the app's owner to turn search on.");
    }

    await client.close();
  });

  it('runs callTool and sends the generated instructions while searchTool is off', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { base, runs } = await start();
    const client = await connect(base);
    const result = await client.callTool({ name: 'callTool', arguments: { operation: 'posts', args: { take: 2 }, select: ['id'] } });
    expect(result.isError).toBeFalsy();
    expect(runs.at(-1)?.variables).toEqual({ take: 2 });
    expect(client.getInstructions()).toContain('- posts: read post, create createPost, update updatePost, delete deletePost.');
    await client.close();
  });

  it.each([
    { nodeEnv: 'development', introspection: undefined, secret: undefined, search: 'search on' },
    { nodeEnv: 'production', introspection: undefined, secret: undefined, search: 'search off (NODE_ENV=production); keystoneMcp({ introspection: true }) turns it on' },
    { nodeEnv: 'development', introspection: false, secret: undefined, search: 'search off (introspection: false); keystoneMcp({ introspection: true }) turns it on' },
    { nodeEnv: 'development', introspection: undefined, secret: 'x'.repeat(32), search: 'search on' },
  ])('logs one mount line with NODE_ENV=$nodeEnv, introspection $introspection and secret $secret', async ({ nodeEnv, introspection, secret, search }) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await start({ introspection, secret, path: '/ai' });
    const signIns = secret ? 'sign-ins sealed with secret' : 'sign-ins end at restart; keystoneMcp({ secret }) keeps them';
    expect(log.mock.calls).toEqual([
      [`keystone-mcp: MCP endpoint at /ai: 9 operations, ${search}, sign-in with authenticateUserWithPassword, ${signIns}.`],
    ]);
  });
});

describe('the X-Forwarded-Proto warning', () => {
  async function startFresh(trustProxy: boolean) {
    // A fresh module, because the warning is once per process.
    vi.resetModules();
    const { keystoneMcp: freshMcp } = await import('../src/mount.js');
    const app = express();

    if (trustProxy) app.set('trust proxy', 1);
    freshMcp()(app, fakeContext().commonContext);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    servers.push(server);

    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const metadata = async (url: string) =>
    ((await (await fetch(url, { headers: { 'x-forwarded-proto': 'https' } })).json()) as { resource: string }).resource;

  it('warns once, naming trust proxy, when a proxy forwards https and Express does not trust it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = await startFresh(false);
    expect(await metadata(`${base}/.well-known/oauth-protected-resource/mcp`)).toMatch(/^http:/);
    await fetch(`${base}/mcp`, { method: 'POST', headers: { 'x-forwarded-proto': 'https' } });
    expect(warn.mock.calls).toEqual([[expect.stringContaining("X-Forwarded-Proto: https, but Express reads it as http")]]);
    expect(warn.mock.calls[0]![0]).toContain("app.set('trust proxy', 1)");
  });

  it('stays silent when Express trusts the proxy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = await startFresh(true);
    expect(await metadata(`${base}/.well-known/oauth-protected-resource/mcp`)).toMatch(/^https:/);
    expect(warn).not.toHaveBeenCalled();
  });
});
