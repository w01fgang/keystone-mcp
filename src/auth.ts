import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
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
import {
  OAuthClientInformationFullSchema,
  type OAuthClientInformationFull,
  type OAuthMetadata,
  type OAuthProtectedResourceMetadata,
  type OAuthTokenRevocationRequest,
  type OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import express, { type Express, type Request, type Response } from 'express';
import { type GraphQLSchema, getNamedType, isNonNullType, isObjectType, isUnionType } from 'graphql';
import { z } from 'zod';
import type { McpContext } from './types.js';

const ACCESS_TOKEN_SECONDS = 60 * 60;
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const CODE_SECONDS = 5 * 60;
const SIGN_IN_SECONDS = 10 * 60;
const SIGN_IN_ATTEMPTS = 5;

/** Above this size a memory store drops its expired entries, and a capped store also its oldest entries. */
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
  /** The Keystone session token. Only the server reads it; `callTool` sends it to `withRequest`. */
  sessionToken: string;
  resource: string;
  scopes: string[];
}

interface Expiring {
  expiresAt: number;
}

interface PendingSignIn extends Expiring {
  clientId: string;
  /** The authorization request. Its resource is in `resource`. */
  params: Omit<AuthorizationParams, 'resource'>;
  /** The resource URL of the grant: the requested one, or the URL of this endpoint. */
  resource: string;
  /** `true` when the authorization request sent `redirect_uri`. The SDK fills `params.redirectUri` when it is absent. */
  redirectUriSent: boolean;
}

interface CodeRecord extends Grant, Expiring {
  codeChallenge: string;
  redirectUri: string;
  /** The code exchange must send `redirect_uri` when the authorization request sent it (RFC 6749 section 4.1.3). */
  redirectUriSent: boolean;
}

type TokenRecord = Grant & Expiring;

export interface McpOAuth {
  /** The app's password mutation that the sign-in page runs. */
  mutation: PasswordMutation;
  /**
   * Verifies the bearer token of an MCP request and returns the request context of its Keystone session.
   * Without a valid token or a live session it answers `401` with `WWW-Authenticate` and returns `undefined`.
   */
  authenticate(req: Request, res: Response): Promise<McpContext | undefined>;
}

/** The value behind each kind of key. A client is kept without its `client_id`, because the `client_id` is the key. */
interface Values {
  client: ClientRecord;
  signIn: PendingSignIn;
  code: CodeRecord;
  access: TokenRecord;
  refresh: TokenRecord;
}

/** A registered client without its `client_id`. A registration does not expire, so it has no `expiresAt`. */
type ClientRecord = Omit<OAuthClientInformationFull, 'client_id'> & { expiresAt?: never };

/** Parses the client that the SDK registers into a `ClientRecord`: it drops the `client_id`. */
const clientRecord = OAuthClientInformationFullSchema.omit({ client_id: true });

type Kind = keyof Values;

/** The authorization request as the client sent it. The SDK has checked that `redirect_uri`, when present, is a URL. */
const authorizationRequest = z.object({ redirect_uri: z.string().optional() });

/** A text field of the sign-in form. `express.urlencoded` gives an array for a repeated field; it reads comma-joined. */
const formText = z.union([z.string(), z.array(z.string())]).transform(String).catch('');

/** The sign-in form. A missing or malformed field reads as `''`, which matches no transaction, decision or user. */
const signInForm = z
  .object({ transaction: z.string().catch(''), decision: z.string().catch(''), identity: formText, secret: formText })
  .catch({ transaction: '', decision: '', identity: '', secret: '' });

/** The data of the password mutation. `sessionToken` is absent when it returns its failure type. */
const signInResult = z.object({ result: z.object({ sessionToken: z.string().min(1) }) });

/** The OAuth state of one MCP path. A key is what the client holds: a `client_id`, a sign-in transaction, a code or a token. */
interface Vault {
  put<K extends Kind>(kind: K, value: Values[K]): string;
  /** The value of a key, or `undefined` when the key is unknown, changed, ended or expired. */
  get<K extends Kind>(kind: K, key: string): Values[K] | undefined;
  /** Ends a key before it expires. A sealed key cannot end early, so the sealed vault does nothing. */
  drop(kind: Kind, key: string): void;
}

/** Registration and the authorize step need no sign-in, so these stores also drop their oldest entries above `MAX_ENTRIES`. */
const CAPPED: Record<Kind, boolean> = { client: true, signIn: true, code: false, access: false, refresh: false };

/** One map for each kind of key, from the key to its value. */
type MemoryStores = { [K in Kind]: Map<string, Values[K]> };

/** Keeps the values in the memory of the process. A key is a random token. */
function memoryVault(): Vault {
  const stores: MemoryStores = {
    client: new Map(),
    signIn: new Map(),
    code: new Map(),
    access: new Map(),
    refresh: new Map(),
  };

  return {
    put(kind, value) {
      const key = newToken();
      remember(stores[kind], key, value, CAPPED[kind]);

      return key;
    },
    get: (kind, key) => live(stores[kind], key),
    drop: (kind, key) => void stores[kind].delete(key),
  };
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Keeps no state: a key is its value, sealed with AES-256-GCM under a key derived from `secret`. Any process with the same
 * secret opens it, and a client cannot read or change it. The path and the kind are authenticated data, so a key of one
 * kind or path does not open as another.
 */
function sealedVault(secret: string, path: string): Vault {
  const key = Buffer.from(hkdfSync('sha256', secret, 'keystone-mcp', 'oauth state', 32));
  const aad = (kind: Kind) => Buffer.from(`${path}\n${kind}`);

  return {
    put(kind, value) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES }).setAAD(aad(kind));
      const sealed = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);

      return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64url');
    },
    get<K extends Kind>(kind: K, sealedKey: string) {
      const data = Buffer.from(sealedKey, 'base64url');

      // Base64 decoding skips foreign characters and ignores the spare bits of the last one, so compare the round trip.
      if (data.length <= IV_BYTES + TAG_BYTES || data.toString('base64url') !== sealedKey) return undefined;
      let value: Values[K];

      try {
        const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES })
          .setAAD(aad(kind))
          .setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

        value = JSON.parse(Buffer.concat([decipher.update(data.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8'));
      } catch {
        return undefined;
      }

      return unexpired(value) ? value : undefined;
    },
    drop() {},
  };
}

interface PathState {
  memory: Vault;
  /** The password checks of each sign-in transaction, in this process. An ended sign-in counts `SIGN_IN_ATTEMPTS`. */
  signInAttempts: Map<string, Expiring & { count: number }>;
}

/**
 * The state of each MCP path, for the life of the process. `keystone dev` calls extendExpressApp again after each
 * rebuild, with a new Express app and context, but keeps this module loaded, so clients and tokens survive a rebuild.
 */
const stateByPath = new Map<string, PathState>();

function stateOf(path: string): PathState {
  let state = stateByPath.get(path);

  if (!state) stateByPath.set(path, (state = { memory: memoryVault(), signInAttempts: new Map() }));

  return state;
}

/**
 * Mounts an OAuth 2.1 authorization server for the MCP endpoint at `path`: metadata, dynamic client registration,
 * an authorize step with a sign-in and consent page, and a token endpoint with S256 PKCE and refresh-token rotation.
 * Sign-in runs the app's password mutation, so Keystone stays the only user store. With `secret`, clients, sign-ins,
 * codes and tokens are sealed values that need no server state. Without it, they are in the memory of the process and
 * survive a new mount at the same path.
 */
export function mountOAuth(app: Express, commonContext: McpContext, path: string, secret?: string): McpOAuth {
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

  const vault = secret ? sealedVault(secret, path) : stateOf(path).memory;
  const { signInAttempts } = stateOf(path);

  const clientOf = (clientId: string): OAuthClientInformationFull | undefined => {
    const client = vault.get('client', clientId);

    return client && { client_id: clientId, ...client };
  };

  const clientsStore: OAuthRegisteredClientsStore = {
    getClient: clientOf,
    registerClient(client) {
      for (const uri of client.redirect_uris) {
        const url = new URL(uri);

        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
          throw new InvalidClientMetadataError(`redirect_uri must use https, or http on a loopback host: ${uri}`);
        }
      }

      // The SDK sets a random client_id, and its type leaves it out. The vault key replaces it.
      const metadata = clientRecord.parse(client);

      return { client_id: vault.put('client', metadata), ...metadata };
    },
  };

  /** Issues an access token and a refresh token for one grant. */
  function issueTokens({ clientId, sessionToken, resource, scopes }: Grant): OAuthTokens {
    const grant: Grant = { clientId, sessionToken, resource, scopes };

    const tokens: OAuthTokens = {
      access_token: vault.put('access', { ...grant, expiresAt: now() + ACCESS_TOKEN_SECONDS }),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_SECONDS,
      refresh_token: vault.put('refresh', { ...grant, expiresAt: now() + REFRESH_TOKEN_SECONDS }),
    };

    if (scopes.length) tokens.scope = scopes.join(' ');

    return tokens;
  }

  const provider: OAuthServerProvider = {
    clientsStore,

    async authorize(client, params, res) {
      const req = res.req;
      const { resource: requested, ...request } = params;
      const resource = resourceUrl(req, path);

      if (requested && !sameResource(requested.href, resource)) {
        throw new InvalidTargetError(`This server is the resource ${resource}.`);
      }

      // The SDK reads the authorization parameters from the body of a POST and from the query of a GET.
      const sent = authorizationRequest.safeParse(req.method === 'POST' ? req.body : req.query);

      const id = vault.put('signIn', {
        clientId: client.client_id,
        params: request,
        resource: requested ? requested.href : resource,
        redirectUriSent: sent.success && sent.data.redirect_uri !== undefined,
        expiresAt: now() + SIGN_IN_SECONDS,
      });

      sendSignInPage(res, 200, { id, client, redirectUri: params.redirectUri, mutation, action: paths.signIn });
    },

    async challengeForAuthorizationCode(client, code) {
      const record = vault.get('code', code);

      if (!record || record.clientId !== client.client_id) throw new InvalidGrantError('The authorization code is not valid.');

      return record.codeChallenge;
    },

    async exchangeAuthorizationCode(client, code, _codeVerifier, redirectUri, resource) {
      const record = vault.get('code', code);
      vault.drop('code', code);

      if (!record || record.clientId !== client.client_id) throw new InvalidGrantError('The authorization code is not valid.');

      if (redirectUri === undefined ? record.redirectUriSent : redirectUri !== record.redirectUri) {
        throw new InvalidGrantError('redirect_uri is not the one of the authorization request.');
      }

      if (resource && !sameResource(resource.href, record.resource)) throw new InvalidTargetError('resource does not match.');

      return issueTokens(record);
    },

    async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
      const record = vault.get('refresh', refreshToken);

      if (!record || record.clientId !== client.client_id) throw new InvalidGrantError('The refresh token is not valid.');
      vault.drop('refresh', refreshToken);

      if (resource && !sameResource(resource.href, record.resource)) throw new InvalidTargetError('resource does not match.');

      if (!(await hasSession(commonContext, record.sessionToken))) {
        throw new InvalidGrantError('Your session has ended. Sign in again.');
      }

      return issueTokens(record);
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const record = vault.get('access', token);

      if (!record) throw new InvalidTokenError('The access token is not valid.');

      return { token, clientId: record.clientId, scopes: record.scopes, expiresAt: record.expiresAt, resource: new URL(record.resource) };
    },

    async revokeToken(client, { token }: OAuthTokenRevocationRequest) {
      for (const kind of ['access', 'refresh'] as const) {
        if (vault.get(kind, token)?.clientId === client.client_id) vault.drop(kind, token);
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
    const body = signInForm.parse(req.body ?? {});
    const id = body.transaction;
    const pending = vault.get('signIn', id);
    const attempts = live(signInAttempts, id)?.count ?? 0;
    const client = pending && attempts < SIGN_IN_ATTEMPTS ? clientOf(pending.clientId) : undefined;

    if (!pending || !client) {
      res.status(400).type('text/plain').send('This sign-in has expired. Start the connection again in your MCP client.');

      return;
    }

    const { params, resource, redirectUriSent, expiresAt } = pending;

    /** Records the password checks of this sign-in, and ends it at the limit. A sealed transaction ends in this process only. */
    const countAttempts = (count: number) => {
      remember(signInAttempts, id, { count, expiresAt }, true);

      if (count >= SIGN_IN_ATTEMPTS) vault.drop('signIn', id);
    };

    if (body.decision !== 'allow') {
      countAttempts(SIGN_IN_ATTEMPTS);
      res.redirect(302, redirectWith(params, { error: 'access_denied', error_description: 'The user denied access.' }));

      return;
    }

    // Count the attempt before the password check, so guesses that arrive at the same time count too.
    countAttempts(attempts + 1);
    let sessionToken: string | undefined;

    try {
      sessionToken = await signIn(req, commonContext, mutation, body.identity, body.secret);
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
        error: attempts + 1 >= SIGN_IN_ATTEMPTS ? 'Too many failed sign-ins. Start the connection again.' : 'The sign-in failed. Check your email and password.',
      });

      return;
    }

    countAttempts(SIGN_IN_ATTEMPTS);

    const code = vault.put('code', {
      clientId: client.client_id,
      sessionToken,
      resource,
      scopes: params.scopes ?? [],
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      redirectUriSent,
      expiresAt: now() + CODE_SECONDS,
    });

    res.redirect(302, redirectWith(params, { code }));
  });

  return {
    mutation,
    async authenticate(req, res) {
      const resource = resourceUrl(req, path);
      const metadataUrl = `${origin(req)}/.well-known/oauth-protected-resource${path}`;
      const header = req.headers.authorization ?? '';
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      const record = match ? vault.get('access', match[1]!) : undefined;

      if (!record || !sameResource(record.resource, resource)) {
        sendUnauthorized(res, metadataUrl, header ? 'The access token is not valid.' : 'Sign in to use this server.');

        return undefined;
      }

      // Keystone's session strategy reads the bearer header first, so the request runs as the signed-in user.
      req.headers.authorization = `Bearer ${record.sessionToken}`;
      const context = await commonContext.withRequest(req, res);

      if (!context.session) {
        vault.drop('access', match![1]!);
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

  const data = signInResult.safeParse(await context.graphql.run({ query, variables: { identity, secret } }));

  return data.success ? data.data.result.sessionToken : undefined;
}

/** `true` when a Keystone session token still has a session: it has not expired, and its user exists. */
async function hasSession(commonContext: McpContext, sessionToken: string): Promise<boolean> {
  const req = new IncomingMessage(new Socket());
  req.headers.authorization = `Bearer ${sessionToken}`;

  return Boolean((await commonContext.withRequest(req)).session);
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

/** `true` for a value without `expiresAt`, or one whose `expiresAt` is in the future. */
function unexpired(value: Partial<Expiring>): boolean {
  return (value.expiresAt ?? Infinity) > now();
}

/** Returns an unexpired entry and drops an expired one. */
function live<T extends Partial<Expiring>>(store: Map<string, T>, key: string): T | undefined {
  const value = store.get(key);

  if (value === undefined || unexpired(value)) return value;
  store.delete(key);

  return undefined;
}

/** Adds an entry. Above `MAX_ENTRIES` it drops expired entries and, when `capped`, the oldest entries. */
function remember<T extends Partial<Expiring>>(store: Map<string, T>, key: string, value: T, capped = false): void {
  store.set(key, value);

  if (store.size <= MAX_ENTRIES) return;

  for (const [k, v] of store) if (!unexpired(v)) store.delete(k);

  if (!capped) return;

  for (const k of store.keys()) {
    if (store.size <= MAX_ENTRIES) break;
    store.delete(k);
  }
}
