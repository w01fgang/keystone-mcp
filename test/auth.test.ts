import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import express from 'express';
import { buildSchema } from 'graphql';
import { afterEach, describe, expect, it } from 'vitest';
import { keystoneMcp } from '../src/mount.js';
import { authorize, CLAUDE_REDIRECT, pkce, register, signIn, submitSignIn, token, transactionOf } from './oauth.js';
import { ADMIN, fakeContext } from './schema.js';

const servers: Server[] = [];
afterEach(() => Promise.all(servers.splice(0).map((server) => once(server.close(), 'close'))));

async function start() {
  const fake = fakeContext();
  const app = express();
  keystoneMcp()(app, fake.commonContext);
  const server = app.listen(0);
  await once(server, 'listening');
  servers.push(server);
  return { ...fake, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const listTools = (base: string, accessToken?: string) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

/** Registers a client and opens its sign-in page. */
async function openSignIn(base: string, redirectUri = CLAUDE_REDIRECT) {
  const clientId = await register(base, [redirectUri]);
  const { verifier, challenge } = pkce();
  const page = await authorize(base, {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
  });
  return { clientId, verifier, page, html: await page.text() };
}

describe('OAuth for /mcp', () => {
  it('answers an unauthenticated POST with 401 and a resource_metadata pointer to metadata that names S256', async () => {
    const { base } = await start();
    const response = await listTools(base);
    expect(response.status).toBe(401);
    const header = response.headers.get('www-authenticate')!;
    expect(header).toMatch(/^Bearer /);
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)![1]!;
    expect(metadataUrl).toBe(`${base}/.well-known/oauth-protected-resource/mcp`);

    const resource = await (await fetch(metadataUrl)).json();
    expect(resource).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base] });
    const server = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(server).toMatchObject({
      issuer: base,
      authorization_endpoint: `${base}/mcp/oauth/authorize`,
      token_endpoint: `${base}/mcp/oauth/token`,
      registration_endpoint: `${base}/mcp/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('refuses a token that it did not issue', async () => {
    const { base } = await start();
    expect((await listTools(base, 'made-up')).status).toBe(401);
  });

  it('shows the redirect host on the consent page, and warns for a loopback host', async () => {
    const { base } = await start();
    const hosted = await openSignIn(base);
    expect(hosted.page.status).toBe(200);
    expect(hosted.page.headers.get('x-frame-options')).toBe('DENY');
    expect(hosted.html).toContain('<span class="host">claude.ai</span>');
    expect(hosted.html).not.toContain('on your own computer');

    const loopback = await openSignIn(base, 'http://127.0.0.1:3118/callback');
    expect(loopback.html).toContain('<span class="host">127.0.0.1:3118</span>');
    expect(loopback.html).toContain('on your own computer');
  });

  it('rejects an authorization request without S256 PKCE', async () => {
    const { base } = await start();
    const clientId = await register(base);
    const withoutS256: Record<string, string>[] = [{ code_challenge: 'abc', code_challenge_method: 'plain' }, { code_challenge_method: 'S256' }];
    for (const pkceParams of withoutS256) {
      const response = await authorize(base, { client_id: clientId, redirect_uri: CLAUDE_REDIRECT, response_type: 'code', ...pkceParams });
      expect(response.status).toBe(302);
      expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
    }
  });

  it('matches redirect URIs exactly, except the port of a loopback host', async () => {
    const { base } = await start();
    const params = (clientId: string, redirect_uri: string) => ({
      client_id: clientId,
      redirect_uri,
      response_type: 'code',
      code_challenge: pkce().challenge,
      code_challenge_method: 'S256',
    });
    const hosted = await register(base);
    for (const other of ['https://claude.ai/api/mcp/auth_callback/', 'https://claude.ai/other', 'https://evil.example/api/mcp/auth_callback']) {
      const response = await authorize(base, params(hosted, other));
      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
    }
    const loopback = await register(base, ['http://localhost/callback', 'http://127.0.0.1/callback']);
    expect((await authorize(base, params(loopback, 'http://localhost:51234/callback'))).status).toBe(200);
    expect((await authorize(base, params(loopback, 'http://127.0.0.1:3118/callback'))).status).toBe(200);
    expect((await authorize(base, params(loopback, 'http://127.0.0.1:3118/other'))).status).toBe(400);
  });

  it('refuses to register a plain-http redirect URI on a public host', async () => {
    const { base } = await start();
    await expect(register(base, ['http://claude.ai/api/mcp/auth_callback'])).rejects.toThrow(/register: 400/);
  });

  it('keeps the sign-in page after a wrong password, and redirects with a code and the state after a right one', async () => {
    const { base } = await start();
    const { html } = await openSignIn(base);
    const transaction = transactionOf(html);
    const wrong = await submitSignIn(base, { transaction, identity: ADMIN.email, secret: 'wrong', decision: 'allow' });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain('The sign-in failed');
    const right = await submitSignIn(base, { transaction, identity: ADMIN.email, secret: ADMIN.password, decision: 'allow' });
    expect(right.status).toBe(302);
    const location = new URL(right.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(CLAUDE_REDIRECT);
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.get('code')).toBeTruthy();
  });

  it('runs at most 5 password checks for one sign-in, also when the guesses arrive at the same time', async () => {
    const { base, commonContext, runs } = await start();
    const { html } = await openSignIn(base);
    const withRequest = commonContext.withRequest;
    commonContext.withRequest = async (req, res) => {
      await sleep(20);
      return withRequest(req, res);
    };
    const transaction = transactionOf(html);
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => submitSignIn(base, { transaction, identity: ADMIN.email, secret: `wrong-${i}`, decision: 'allow' })),
    );
    expect(runs.filter((run) => run.query.includes('KeystoneMcpSignIn'))).toHaveLength(5);
    expect(responses.filter((response) => response.status === 401)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(5);
  });

  it('answers 500 when Keystone fails during sign-in, instead of leaving the request open', async () => {
    const { base, commonContext } = await start();
    const { html } = await openSignIn(base);
    commonContext.withRequest = () => Promise.reject(new Error('the database is down'));
    const response = await submitSignIn(base, {
      transaction: transactionOf(html),
      identity: ADMIN.email,
      secret: ADMIN.password,
      decision: 'allow',
    });
    expect(response.status).toBe(500);
    expect(response.headers.get('location')).toBeNull();
  });

  it('marks the metadata documents as uncacheable and varying by Host, because they name the request host', async () => {
    const { base } = await start();
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server']) {
      const response = await fetch(base + path);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('vary')).toMatch(/\bHost\b/);
    }
  });

  it('redirects with access_denied when the user cancels', async () => {
    const { base } = await start();
    const { html } = await openSignIn(base);
    const response = await submitSignIn(base, { transaction: transactionOf(html), decision: 'deny' });
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('xyz');
  });

  it('exchanges a code once, and only with its PKCE verifier and redirect URI', async () => {
    const { base } = await start();
    const codeFor = async () => {
      const { clientId, verifier, html } = await openSignIn(base);
      const signedIn = await submitSignIn(base, { transaction: transactionOf(html), identity: ADMIN.email, secret: ADMIN.password, decision: 'allow' });
      const code = new URL(signedIn.headers.get('location')!).searchParams.get('code')!;
      return (fields: Record<string, string>) =>
        token(base, { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: CLAUDE_REDIRECT, ...fields });
    };

    const exchange = await codeFor();
    expect((await exchange({ code_verifier: pkce().verifier })).body.error).toBe('invalid_grant');
    const first = await exchange({});
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    expect((await exchange({})).body.error).toBe('invalid_grant');

    const otherRedirect = await codeFor();
    expect((await otherRedirect({ redirect_uri: 'https://claude.ai/other' })).body.error).toBe('invalid_grant');
  });

  it('needs redirect_uri at the code exchange only when the authorization request sent one', async () => {
    const { base } = await start();
    const exchangeWithoutRedirect = async (authorizeRedirect: Record<string, string>) => {
      const clientId = await register(base);
      const { verifier, challenge } = pkce();
      const page = await authorize(base, { client_id: clientId, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', ...authorizeRedirect });
      const signedIn = await submitSignIn(base, { transaction: transactionOf(await page.text()), identity: ADMIN.email, secret: ADMIN.password, decision: 'allow' });
      const code = new URL(signedIn.headers.get('location')!).searchParams.get('code')!;
      return token(base, { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier });
    };
    expect((await exchangeWithoutRedirect({ redirect_uri: CLAUDE_REDIRECT })).body.error).toBe('invalid_grant');
    expect((await exchangeWithoutRedirect({})).status).toBe(200);
  });

  it('rotates the refresh token: the new pair works and the old refresh token gets invalid_grant', async () => {
    const { base } = await start();
    const { clientId, refreshToken } = await signIn(base);
    const refreshed = await token(base, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(refreshToken);
    expect((await listTools(base, refreshed.body.access_token)).status).toBe(200);
    const again = await token(base, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });
    expect(again).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
  });

  it('refuses a token whose Keystone session has ended, on /mcp and on refresh', async () => {
    const { base, sessions } = await start();
    const { clientId, accessToken, refreshToken } = await signIn(base);
    sessions.clear();
    const response = await listTools(base, accessToken);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect(response.headers.get('www-authenticate')).not.toMatch(/keystone/i);
    const refreshed = await token(base, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });
    expect(refreshed.body.error).toBe('invalid_grant');
    expect(refreshed.body.error_description).not.toMatch(/keystone/i);
  });

  it('keeps clients and tokens when a dev rebuild mounts the endpoint again', async () => {
    // keystone dev serves each rebuild from a new Express app, a new context and a new keystoneMcp() on the same server.
    const first = fakeContext();
    let current = express();
    keystoneMcp()(current, first.commonContext);
    const server = createServer((req, res) => current(req, res));
    server.listen(0);
    await once(server, 'listening');
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { clientId, accessToken, refreshToken } = await signIn(base);

    const rebuilt = fakeContext();
    for (const [token, session] of first.sessions) rebuilt.sessions.set(token, session);
    current = express();
    keystoneMcp()(current, rebuilt.commonContext);
    expect((await listTools(base, accessToken)).status).toBe(200);
    expect(rebuilt.requests.at(-1)?.headers.authorization).toBe('Bearer keystone-session-1');
    const refreshed = await token(base, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });
    expect(refreshed.status).toBe(200);
  });

  it('refuses to mount on a schema without a password sign-in mutation', () => {
    const schema = buildSchema('type Query { posts: [String] }');
    const context = { ...fakeContext().commonContext, graphql: { schema, run: async () => ({}) } };
    expect(() => keystoneMcp()(express(), context)).toThrow(/authenticate<List>WithPassword/);
  });
});
