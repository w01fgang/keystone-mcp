import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { buildCall, type Call } from './call.js';
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, searchCatalog } from './search.js';
import { CallError, type Catalog, type McpContext } from './types.js';

export const SERVER_INFO = { name: 'keystone-mcp', version: '0.1.0' };

export interface McpServerOptions {
  catalog: Catalog;
  /** The context of one HTTP request, from `context.withRequest`. `callTool` runs as its session. */
  context: McpContext;
  takeLimit: number;
}

/** Creates an MCP server with the tools `searchTool` and `callTool` for one request. */
export function createMcpServer({ catalog, context, takeLimit }: McpServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    'searchTool',
    {
      description:
        'Find the GraphQL queries and mutations of this Keystone app. ' +
        'Each result has the operation name, its kind, its return type, its argument signatures, ' +
        'and the field paths that callTool can select.',
      inputSchema: {
        text: z.string().describe('Words to match, for example "posts" or "create user".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_LIMIT)
          .optional()
          .describe(`The number of results. Default: ${DEFAULT_SEARCH_LIMIT}. Maximum: ${MAX_SEARCH_LIMIT}.`),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ text, limit }) => textResult({ operations: searchCatalog(catalog, { text, limit }) }),
  );

  server.registerTool(
    'callTool',
    {
      description:
        'Run one GraphQL operation that searchTool found, as the session of this request. ' +
        `Arguments become GraphQL variables. A take argument is at most ${takeLimit}. ` +
        'select lists field paths from searchTool; without select, the call returns the top-level paths.',
      inputSchema: {
        operation: z.string().describe('The operation name from searchTool, for example "posts".'),
        args: z.record(z.unknown()).optional().describe('Argument values by argument name.'),
        select: z.array(z.string()).optional().describe('Field paths from searchTool, for example ["id", "author.name"].'),
      },
    },
    async (input) => {
      let call: Call;
      try {
        call = buildCall(catalog, input, takeLimit);
      } catch (error) {
        if (error instanceof CallError) return errorResult(error.message);
        throw error;
      }
      try {
        const data = await context.graphql.run({ query: call.document, variables: call.variables });
        return textResult(data);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  return server;
}

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
