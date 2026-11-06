import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';
import { mountOAuth } from './auth.js';
import { buildCatalog } from './catalog.js';
import { createMcpServer } from './server.js';
import type { KeystoneMcpOptions, McpContext, ResolvedOptions } from './types.js';

function resolveOptions(options: KeystoneMcpOptions): ResolvedOptions {
  const resolved = {
    path: options.path ?? '/mcp',
    queriesOnly: options.queriesOnly ?? false,
    takeLimit: options.takeLimit ?? 50,
    // Apollo Server's default. Keystone passes extendExpressApp no config, so the app's apolloConfig is out of reach.
    introspection: options.introspection ?? process.env.NODE_ENV !== 'production',
  };
  if (!resolved.path.startsWith('/')) throw new TypeError(`keystoneMcp: path must start with "/", got "${resolved.path}".`);
  if (!Number.isInteger(resolved.takeLimit) || resolved.takeLimit < 1) {
    throw new TypeError(`keystoneMcp: takeLimit must be a positive integer, got ${resolved.takeLimit}.`);
  }
  return resolved;
}

/**
 * Returns a function for `server.extendExpressApp` in `keystone.ts`.
 * It mounts the MCP endpoint at `options.path` and the OAuth authorization server for it. Each `POST` needs an
 * access token and creates a stateless MCP server that runs as the Keystone session behind that token.
 */
export function keystoneMcp(options: KeystoneMcpOptions = {}) {
  const { path, queriesOnly, takeLimit, introspection } = resolveOptions(options);

  return function extendExpressApp(app: Express, commonContext: McpContext): void {
    // Keystone calls extendExpressApp again after each dev rebuild, with the new schema.
    const catalog = buildCatalog(commonContext.graphql.schema, { queriesOnly });
    const oauth = mountOAuth(app, commonContext, path);

    app.post(path, express.json(), async (req: Request, res: Response) => {
      try {
        const context = await oauth.authenticate(req, res);
        if (!context) return;
        const server = createMcpServer({ catalog, context, takeLimit, introspection });
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

function sendJsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}
