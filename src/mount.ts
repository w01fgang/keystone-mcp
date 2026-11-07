import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { mountOAuth } from './auth.js';
import { buildCatalog } from './catalog.js';
import { buildInstructions } from './instructions.js';
import { createMcpServer } from './server.js';
import type { KeystoneMcpOptions, McpContext, ResolvedOptions } from './types.js';

/** The `secret` option. An app in JavaScript can pass any value, so `resolveOptions` parses it. */
const secretOption = z.string().min(32).optional();

function resolveOptions(options: KeystoneMcpOptions): ResolvedOptions {
  const resolved = {
    path: options.path ?? '/mcp',
    queriesOnly: options.queriesOnly ?? false,
    takeLimit: options.takeLimit ?? 50,
    // Apollo Server's default. Keystone passes extendExpressApp no config, so the app's apolloConfig is out of reach.
    introspection: options.introspection ?? process.env.NODE_ENV !== 'production',
    instructions: options.instructions?.trim() || undefined,
    secret: options.secret,
  };

  if (!resolved.path.startsWith('/')) throw new TypeError(`keystoneMcp: path must start with "/", got "${resolved.path}".`);

  if (!Number.isInteger(resolved.takeLimit) || resolved.takeLimit < 1) {
    throw new TypeError(`keystoneMcp: takeLimit must be a positive integer, got ${resolved.takeLimit}.`);
  }

  if (!secretOption.safeParse(resolved.secret).success) {
    throw new TypeError('keystoneMcp: secret must be a string of 32 characters or more.');
  }

  return resolved;
}

/**
 * Returns a function for `server.extendExpressApp` in `keystone.ts`.
 * It mounts the MCP endpoint at `options.path` and the OAuth authorization server for it. Each `POST` needs an
 * access token and creates a stateless MCP server that runs as the Keystone session behind that token.
 */
export function keystoneMcp(options: KeystoneMcpOptions = {}) {
  const { path, queriesOnly, takeLimit, introspection, instructions: about, secret } = resolveOptions(options);

  const search = introspection
    ? 'search on'
    : `search off (${options.introspection === false ? 'introspection: false' : 'NODE_ENV=production'}); ` +
      'keystoneMcp({ introspection: true }) turns it on';

  const signIns = secret ? 'sign-ins sealed with secret' : 'sign-ins end at restart; keystoneMcp({ secret }) keeps them';

  return function extendExpressApp(app: Express, commonContext: McpContext): void {
    // Keystone calls extendExpressApp again after each dev rebuild, with the new schema.
    const catalog = buildCatalog(commonContext.graphql.schema, { queriesOnly });
    const instructions = buildInstructions(catalog, { about, introspection });
    app.use([path, '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server'], warnUntrustedProxy);
    const oauth = mountOAuth(app, commonContext, path, secret);
    console.log(
      `keystone-mcp: MCP endpoint at ${path}: ${catalog.entries.length} operations, ${search}, sign-in with ${oauth.mutation.name}, ${signIns}.`,
    );

    app.post(path, express.json(), async (req: Request, res: Response) => {
      try {
        const context = await oauth.authenticate(req, res);

        if (!context) return;
        const server = createMcpServer({ catalog, context, takeLimit, introspection, instructions });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('keystone-mcp: the MCP request failed.', error);

        if (!res.headersSent) sendJsonRpcError(res, 500, -32603, 'Internal server error.');
      }
    });

    // A stateless server has no SSE stream for GET and no session for DELETE.
    const methodNotAllowed = (_req: Request, res: Response) => sendJsonRpcError(res, 405, -32000, 'Method not allowed.');
    app.get(path, methodNotAllowed);
    app.delete(path, methodNotAllowed);
  };
}

/** Once per process: a dev rebuild mounts again, and one warning is enough. */
let warnedUntrustedProxy = false;

/**
 * Warns when a proxy says the request came over https, but Express does not trust the proxy and reads http.
 * The OAuth URLs then use http, and a client that connected over https refuses them.
 */
function warnUntrustedProxy(req: Request, _res: Response, next: NextFunction): void {
  const forwarded = req.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();

  if (!warnedUntrustedProxy && forwarded === 'https' && req.protocol === 'http') {
    warnedUntrustedProxy = true;
    console.warn(
      `keystone-mcp: a request to ${req.baseUrl}${req.path === '/' ? '' : req.path} has X-Forwarded-Proto: https, ` +
        'but Express reads it as http, so the OAuth URLs use http and MCP clients refuse them. ' +
        "Behind a proxy or tunnel that ends TLS, call app.set('trust proxy', 1) in extendExpressApp.",
    );
  }

  next();
}

function sendJsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}
