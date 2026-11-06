import { randomBytes } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import express, { type Express, type Request, type Response } from 'express';
import { type GraphQLSchema, getNamedType, isNonNullType, isObjectType, isUnionType } from 'graphql';
import type { McpContext } from './types.js';

const ACCESS_TOKEN_SECONDS = 60 * 60;
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const CODE_SECONDS = 5 * 60;
const SIGN_IN_SECONDS = 10 * 60;
const SIGN_IN_ATTEMPTS = 5;
/**
 * Above this size a store drops its expired entries. Registration and the authorize step need no sign-in,
 * so the stores of clients and pending sign-ins also drop their oldest entries above it.
 */
const MAX_ENTRIES = 1000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The app's `authenticate<List>WithPassword` mutation, from `@keystone-6/auth`. */
export interface PasswordMutation {
  name: string;
  identityArg: string;
  secretArg: string;
  successType: string;
}

/**
 * Finds the password mutation that `@keystone-6/auth` adds: two `String!` arguments, identity then secret,
 * and a union result whose success member has `sessionToken`.
 */
export function findPasswordMutation(schema: GraphQLSchema): PasswordMutation | undefined {
  for (const field of Object.values(schema.getMutationType()?.getFields() ?? {})) {
    if (!/^authenticate\w+WithPassword$/.test(field.name) || field.args.length !== 2) continue;
    const result = getNamedType(field.type);
    if (!isUnionType(result)) continue;
    const success = result.getTypes().find((type) => isObjectType(type) && 'sessionToken' in type.getFields());
    if (!success || !field.args.every((arg) => isNonNullType(arg.type) && getNamedType(arg.type).name === 'String')) continue;
    return { name: field.name, identityArg: field.args[0]!.name, secretArg: field.args[1]!.name, successType: success.name };
  }
  return undefined;
}

interface Grant {
  clientId: string;
  /** The Keystone session token. It stays on the server; `callTool` sends it to `withRequest`. */
  sessionToken: string;
  resource: string;
  scopes: string[];
}

interface Expiring {
  expiresAt: number;
}

interface PendingSignIn extends Expiring {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  attempts: number;
}

interface CodeRecord extends Grant, Expiring {
  codeChallenge: string;
  redirectUri: string;
}

type TokenRecord = Grant & Expiring;

export interface McpOAuth {
  /**
   * Verifies the bearer token of an MCP request and returns the request context of its Keystone session.
   * Without a valid token or a live session it answers `401` with `WWW-Authenticate` and returns `undefined`.
   */
  authenticate(req: Request, res: Response): Promise<McpContext | undefined>;
}

/**
 * Mounts an OAuth 2.1 authorization server for the MCP endpoint at `path`: metadata, dynamic client registration,
 * an authorize step with a sign-in and consent page, and a token endpoint with S256 PKCE and refresh-token rotation.
 * Sign-in runs the app's password mutation, so Keystone stays the only user store. State is in memory.
 */
export function mountOAuth(app: Express, commonContext: McpContext, path: string): McpOAuth {
  const mutation = findPasswordMutation(commonContext.graphql.schema);
  if (!mutation) {
    throw new Error(
      `keystoneMcp: ${path} needs a password sign-in. The GraphQL schema has no authenticate<List>WithPassword mutation; ` +
        'add createAuth from @keystone-6/auth to keystone.ts.',
    );
  }
  const paths = {
    authorize: `${path}/oauth/authorize`,
    signIn: `${path}/oauth/signin`,
    token: `${path}/oauth/token`,
    register: `${path}/oauth/register`,
    revoke: `${path}/oauth/revoke`,
  };

  const clients = new Map<string, OAuthClientInformationFull>();
  const pendingSignIns = new Map<string, PendingSignIn>();
  const codes = new Map<string, CodeRecord>();
  const accessTokens = new Map<string, TokenRecord>();
  const refreshTokens = new Map<string, TokenRecord>();

  const clientsStore: OAuthRegisteredClientsStore = {
    getClient: (clientId) => clients.get(clientId),
    registerClient(client) {
      for (const uri of client.redirect_uris) {
        const url = new URL(uri);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
          throw new InvalidClientMetadataError(`redirect_uri must use https, or http on a loopback host: ${uri}`);
        }
      }
      const full = client as OAuthClientInformationFull;
      remember(clients, full.client_id, full, true);
      return full;
    },
  };

  /** Issues an access token and a refresh token for one grant. */
  function issueTokens(grant: Grant): OAuthTokens {
    const accessToken = newToken();
    const refreshToken = newToken();
    remember(accessTokens, accessToken, { ...grant, expiresAt: now() + ACCESS_TOKEN_SECONDS });
    remember(refreshTokens, refreshToken, { ...grant, expiresAt: now() + REFRESH_TOKEN_SECONDS });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_SECONDS,
      refresh_token: refreshToken,
      ...(grant.scopes.length ? { scope: grant.scopes.join(' ') } : {}),
    };
  }

  const provider: OAuthServerProvider = {
    clientsStore,

    async authorize(client, params, res) {
      const req = res.req as Request;
      const resource = resourceUrl(req, path);
      if (params.resource && !sameResource(params.resource.href, resource)) {
        throw new InvalidTargetError(`This server is the resource ${resource}.`);
      }
      const id = newToken();
      remember(pendingSignIns, id, { client, params, attempts: 0, expiresAt: now() + SIGN_IN_SECONDS }, true);
      sendSignInPage(res, 200, { id, client, redirectUri: params.redirectUri, mutation, action: paths.signIn });
    },

    async challengeForAuthorizationCode(client, code) {
      const record = live(codes, code);
      if (!record || record.clientId !== client.client_id) throw new InvalidGrantError('The authorization code is not valid.');
      return record.codeChallenge;
    },

    async exchangeAuthorizationCode(client, code, _codeVerifier, redirectUri, resource) {
      const record = live(codes, code);
      codes.delete(code);
      if (!record || record.clientId !== client.client_id) throw new InvalidGrantError('The authorization code is not valid.');
      if (redirectUri !== undefined && redirectUri !== record.redirectUri) {
        throw new InvalidGrantError('redirect_uri is not the one of the authorization request.');
      }
      if (resource && !sameResource(resource.href, record.resource)) throw new InvalidTargetError('resource does not match.');
      return issueTokens(record);
    },

    async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
      const record = live(refreshTokens, refreshToken);
      if (!record || record.clientId !== client.client_id) throw new InvalidGrantError('The refresh token is not valid.');
      refreshTokens.delete(refreshToken);
      if (resource && !sameResource(resource.href, record.resource)) throw new InvalidTargetError('resource does not match.');
      if (!(await sessionOf(commonContext, record.sessionToken))) {
        throw new InvalidGrantError('Your session has ended. Sign in again.');
      }
      return issueTokens(record);
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const record = live(accessTokens, token);
      if (!record) throw new InvalidTokenError('The access token is not valid.');
      return { token, clientId: record.clientId, scopes: record.scopes, expiresAt: record.expiresAt, resource: new URL(record.resource) };
    },

    async revokeToken(client, { token }: OAuthTokenRevocationRequest) {
      for (const store of [accessTokens, refreshTokens]) {
        if (store.get(token)?.clientId === client.client_id) store.delete(token);
      }
    },
  };

  // Discovery documents. The issuer and the resource come from the request, because Keystone gives
  // extendExpressApp no public URL. Behind a TLS proxy, Express `trust proxy` makes req.protocol https.
  const sendMetadata = (build: (req: Request) => object) => (req: Request, res: Response) => {
    // The documents name the request host, so a shared cache must not serve one host's copy to another.
    res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', Vary: 'Host' });
    res.json(build(req));
  };
  const protectedResource = sendMetadata((req): OAuthProtectedResourceMetadata => ({
    resource: resourceUrl(req, path),
    authorization_servers: [origin(req)],
    bearer_methods_supported: ['header'],
  }));
  app.get(`/.well-known/oauth-protected-resource${path}`, protectedResource);
  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get(
    '/.well-known/oauth-authorization-server',
    sendMetadata((req): OAuthMetadata => {
      const base = origin(req);
      return {
        issuer: base,
        authorization_endpoint: base + paths.authorize,
        token_endpoint: base + paths.token,
        registration_endpoint: base + paths.register,
        revocation_endpoint: base + paths.revoke,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      };
    }),
  );

  app.use(paths.authorize, authorizationHandler({ provider }));
  app.use(paths.token, tokenHandler({ provider }));
  app.use(paths.register, clientRegistrationHandler({ clientsStore }));
  app.use(paths.revoke, revocationHandler({ provider }));

  app.post(paths.signIn, express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = typeof body.transaction === 'string' ? body.transaction : '';
    const pending = live(pendingSignIns, id);
    if (!pending) {
      res.status(400).type('text/plain').send('This sign-in has expired. Start the connection again in your MCP client.');
      return;
    }
    const { client, params } = pending;
    if (body.decision !== 'allow') {
      pendingSignIns.delete(id);
      res.redirect(302, redirectWith(params, { error: 'access_denied', error_description: 'The user denied access.' }));
      return;
    }
    // Count the attempt before the password check, so guesses that arrive at the same time count too.
    pending.attempts += 1;
    if (pending.attempts >= SIGN_IN_ATTEMPTS) pendingSignIns.delete(id);
    let sessionToken: string | undefined;
    try {
      sessionToken = await signIn(req, commonContext, mutation, String(body.identity ?? ''), String(body.secret ?? ''));
    } catch (error) {
      console.error('keystone-mcp: the sign-in request failed.', error);
      res.status(500).type('text/plain').send('The sign-in failed because of a server error. Try again later.');
      return;
    }
    if (!sessionToken) {
      sendSignInPage(res, 401, {
        id,
        client,
        redirectUri: params.redirectUri,
        mutation,
        action: paths.signIn,
        error: pending.attempts >= SIGN_IN_ATTEMPTS ? 'Too many failed sign-ins. Start the connection again.' : 'The sign-in failed. Check your email and password.',
      });
      return;
    }
    pendingSignIns.delete(id);
    const code = newToken();
    remember(codes, code, {
      clientId: client.client_id,
      sessionToken,
      resource: params.resource ? params.resource.href : resourceUrl(req, path),
      scopes: params.scopes ?? [],
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      expiresAt: now() + CODE_SECONDS,
    });
    res.redirect(302, redirectWith(params, { code }));
  });

  return {
    async authenticate(req, res) {
      const resource = resourceUrl(req, path);
      const metadataUrl = `${origin(req)}/.well-known/oauth-protected-resource${path}`;
      const header = req.headers.authorization ?? '';
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      const record = match ? live(accessTokens, match[1]!) : undefined;
      if (!record || !sameResource(record.resource, resource)) {
        sendUnauthorized(res, metadataUrl, header ? 'The access token is not valid.' : 'Sign in to use this server.');
        return undefined;
      }
      // Keystone's session strategy reads the bearer header first, so the request runs as the signed-in user.
      req.headers.authorization = `Bearer ${record.sessionToken}`;
      const context = await commonContext.withRequest(req, res);
      if (!context.session) {
        accessTokens.delete(match![1]!);
        sendUnauthorized(res, metadataUrl, 'Your session has ended. Sign in again.');
        return undefined;
      }
      return context;
    },
  };
}

/** Runs the password mutation. A throwaway response takes Keystone's `Set-Cookie`, so the browser gets no Admin UI session. */
async function signIn(
  req: Request,
  commonContext: McpContext,
  mutation: PasswordMutation,
  identity: string,
  secret: string,
): Promise<string | undefined> {
  if (!identity || !secret) return undefined;
  const context = await commonContext.withRequest(req, new ServerResponse(req));
  const query =
    `mutation KeystoneMcpSignIn($identity: String!, $secret: String!) { ` +
    `result: ${mutation.name}(${mutation.identityArg}: $identity, ${mutation.secretArg}: $secret) { ` +
    `... on ${mutation.successType} { sessionToken } } }`;
  const data = (await context.graphql.run({ query, variables: { identity, secret } })) as { result?: { sessionToken?: unknown } };
  const token = data.result?.sessionToken;
  return typeof token === 'string' && token ? token : undefined;
}

/** The session of a Keystone session token, or `undefined` when it has expired or its user is gone. */
async function sessionOf(commonContext: McpContext, sessionToken: string): Promise<unknown> {
  const req = new IncomingMessage(new Socket());
  req.headers.authorization = `Bearer ${sessionToken}`;
  return (await commonContext.withRequest(req)).session;
}

function sendUnauthorized(res: Response, metadataUrl: string, description: string): void {
  res
    .status(401)
    .set('WWW-Authenticate', `Bearer error="invalid_token", error_description="${description}", resource_metadata="${metadataUrl}"`)
    .json({ error: 'invalid_token', error_description: description });
}

interface SignInPage {
  id: string;
  client: OAuthClientInformationFull;
  redirectUri: string;
  mutation: PasswordMutation;
  action: string;
  error?: string;
}

/** The sign-in and consent page. It names the redirect host, because the client name is self-asserted. */
function sendSignInPage(res: Response, status: number, { id, client, redirectUri, mutation, action, error }: SignInPage): void {
  const host = new URL(redirectUri).host;
  const loopback = LOOPBACK_HOSTS.has(new URL(redirectUri).hostname);
  const name = client.client_name ? `“${escapeHtml(client.client_name)}”` : 'An MCP client';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to connect an MCP client</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#111}
label{display:block;margin-top:1rem}input{width:100%;padding:.5rem;font:inherit;box-sizing:border-box}
.host{font-weight:700;word-break:break-all}.warn,.error{padding:.75rem;border-radius:.25rem;margin:1rem 0}
.warn{background:#fff4d6}.error{background:#fde2e2}button{margin-top:1.5rem;margin-right:.5rem;padding:.5rem 1rem;font:inherit}</style>
</head><body>
<h1>Sign in to connect an MCP client</h1>
<p>${name} asks to act as you in this app. It can read and change what your account can read and change.</p>
<p>After you sign in, your browser goes to <span class="host">${escapeHtml(host)}</span>. Continue only if you started this connection there.</p>
${loopback ? '<p class="warn">This address is on your own computer. Any program on this computer can listen there. Continue only if you started the connection from an app on this computer.</p>' : ''}
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="${escapeHtml(action)}">
<input type="hidden" name="transaction" value="${escapeHtml(id)}">
<label>${escapeHtml(mutation.identityArg)}<input name="identity" autocomplete="username" required></label>
<label>${escapeHtml(mutation.secretArg)}<input name="secret" type="password" autocomplete="current-password" required></label>
<button type="submit" name="decision" value="allow">Sign in and allow</button>
<button type="submit" name="decision" value="deny" formnovalidate>Cancel</button>
</form></body></html>`;
  res
    .status(status)
    .set({
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    })
    .type('html')
    .send(html);
}

function redirectWith({ redirectUri, state }: AuthorizationParams, values: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  if (state !== undefined) url.searchParams.set('state', state);
  return url.href;
}

function origin(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

function resourceUrl(req: Request, path: string): string {
  return origin(req) + path;
}

/** Compares resource URLs without a fragment and one trailing slash, as the SDK's bearer middleware does. */
function sameResource(a: string, b: string): boolean {
  const comparable = (value: string) => value.replace(/#.*$/, '').replace(/\/$/, '');
  return comparable(a) === comparable(b);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Returns an unexpired entry and drops an expired one. */
function live<T extends Expiring>(store: Map<string, T>, key: string): T | undefined {
  const value = store.get(key);
  if (value && value.expiresAt <= now()) store.delete(key);
  return value && value.expiresAt > now() ? value : undefined;
}

/** Adds an entry. Above `MAX_ENTRIES` it drops expired entries and, when `capped`, the oldest entries. */
function remember<T>(store: Map<string, T>, key: string, value: T, capped = false): void {
  store.set(key, value);
  if (store.size <= MAX_ENTRIES) return;
  const time = now();
  for (const [k, v] of store) if (((v as Partial<Expiring>).expiresAt ?? Infinity) <= time) store.delete(k);
  if (!capped) return;
  for (const k of store.keys()) {
    if (store.size <= MAX_ENTRIES) break;
    store.delete(k);
  }
}
