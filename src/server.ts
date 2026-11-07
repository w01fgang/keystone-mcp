import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { GraphQLError, Kind } from 'graphql';
import { z } from 'zod';
import { buildCall, type Call } from './call.js';
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, searchCatalog } from './search.js';
import { CallError, type Catalog, type McpContext } from './types.js';

export const SERVER_INFO = { name: 'keystone-mcp', version: '0.1.0' };

/**
 * The text that the agent reads: tool descriptions, argument descriptions and the search-off message. Like the
 * instructions from `buildInstructions`, it describes the project and names no technology.
 */
const SEARCH_OFF_MESSAGE =
  "searchTool is off in this project. Ask the app's owner to turn search on. " +
  'callTool still runs an operation by name; the server instructions name the operations for one record.';

export interface McpServerOptions {
  catalog: Catalog;
  /** The context of one HTTP request, from `context.withRequest`. `callTool` runs as its session. */
  context: McpContext;
  takeLimit: number;
  /** When `false`, `searchTool` returns a tool error that asks the agent to have search turned on. */
  introspection: boolean;
  /** The server instructions that `initialize` sends, from `buildInstructions`. */
  instructions: string;
}

/** Creates an MCP server with the tools `searchTool` and `callTool` for one request. */
export function createMcpServer({ catalog, context, takeLimit, introspection, instructions }: McpServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions });

  server.registerTool(
    'searchTool',
    {
      description:
        'Find the operations of this project: the ways to read and change its records. ' +
        'Each result has the operation name, its kind (query reads, mutation changes), its return type, ' +
        'its argument signatures, and the field paths that callTool can select.',
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
    async ({ text, limit }) =>
      introspection ? textResult({ operations: searchCatalog(catalog, { text, limit }) }) : errorResult(SEARCH_OFF_MESSAGE),
  );

  server.registerTool(
    'callTool',
    {
      description:
        'Run one operation that searchTool found, as the signed-in user. ' +
        `args holds the argument values by name. A take argument is at most ${takeLimit}. ` +
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
        return errorResult(JSON.stringify({ errors: [formatGraphQLError(error)] }));
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

/**
 * Formats a rejection from `graphql.run` as Keystone's `/api/graphql` formats the same error, so a client sees
 * the same message and code on both paths. Keystone does not export its formatter, so this follows its steps:
 * - Apollo Server gives a variable that fails coercion the code `BAD_USER_INPUT`
 *   (`isBadUserInputGraphQLError` in `@apollo/server` `requestPipeline`).
 * - Apollo Server gives an error without a code the code `INTERNAL_SERVER_ERROR` (`enrichError` in `errorNormalize`).
 * - Keystone replaces an error that Prisma caused with "Prisma error" and the code `KS_PRISMA_ERROR`
 *   (`formatError` in `@keystone-6/core` `src/lib/express.ts`).
 * Only the message and the code go to the client. The app's `graphql.apolloConfig.formatError` does not run here.
 */
function formatGraphQLError(error: unknown): { message: string; extensions: { code: unknown } } {
  if (error instanceof GraphQLError && error.originalError?.name.startsWith('Prisma')) {
    return { message: 'Prisma error', extensions: { code: 'KS_PRISMA_ERROR' } };
  }
  if (!(error instanceof Error)) {
    return { message: `Unexpected error value: ${String(error)}`, extensions: { code: 'INTERNAL_SERVER_ERROR' } };
  }
  const code = error instanceof GraphQLError ? error.extensions.code : undefined;
  if (code != null) return { message: error.message, extensions: { code } };
  return { message: error.message, extensions: { code: isBadUserInput(error) ? 'BAD_USER_INPUT' : 'INTERNAL_SERVER_ERROR' } };
}

/** Apollo Server's test for an error from variable coercion. */
function isBadUserInput(error: Error): boolean {
  const node = error instanceof GraphQLError && error.nodes?.length === 1 ? error.nodes[0] : undefined;
  if (node?.kind !== Kind.VARIABLE_DEFINITION) return false;
  const variable = `Variable "$${node.variable.name.value}"`;
  return [' has invalid value', ' got invalid value ', ' of required type ', ' of non-null type '].some((rest) =>
    error.message.startsWith(variable + rest),
  );
}
