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
        if (error instanceof CallError) return callErrorResult({ code: 'INVALID_INPUT', message: error.message });
        throw error;
      }
      try {
        const data = await context.graphql.run({ query: call.document, variables: call.variables });
        return textResult(data);
      } catch (error) {
        const neutral = neutralError(error);
        if (neutral.message !== undefined) return callErrorResult({ code: neutral.code, message: neutral.message });
        // The agent reads only a fixed sentence, so the app's owner finds the cause here.
        console.error(`keystone-mcp: callTool "${call.entry.name}" failed:`, error);
        return callErrorResult({ code: neutral.code, message: FIXED_MESSAGES[neutral.code] });
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

/** The codes that a failed `callTool` returns. Each one names what went wrong, not the technology that found it. */
type ErrorCode = 'ACCESS_DENIED' | 'INVALID_INPUT' | 'SERVER_ERROR';

/** The message for an error whose own message the agent must not read. */
const FIXED_MESSAGES: Record<ErrorCode, string> = {
  ACCESS_DENIED: 'Access denied.',
  INVALID_INPUT: 'The input of this operation is not valid.',
  SERVER_ERROR: "The server could not run this operation. The app's owner can find the cause in the server log.",
};

/** Words that name the technology under the project. A message that contains one is replaced. */
const TECHNOLOGY = /keystone|graphql|prisma|apollo/i;

/** A failed `callTool` gives this text: `{"errors":[{"message":…,"extensions":{"code":…}}]}`. */
function callErrorResult({ code, message }: { code: ErrorCode; message: string }): CallToolResult {
  return errorResult(JSON.stringify({ errors: [{ message, extensions: { code } }] }));
}

/** The Keystone codes by meaning (`@keystone-6/core` `src/lib/core/graphql-errors.ts` and `src/lib/createSystem.ts`). */
const KEYSTONE_CODES: Record<string, ErrorCode | 'FIELD_ERRORS'> = {
  KS_ACCESS_DENIED: 'ACCESS_DENIED',
  KS_FILTER_DENIED: 'ACCESS_DENIED',
  KS_USER_INPUT_ERROR: 'INVALID_INPUT',
  KS_VALIDATION_FAILURE: 'INVALID_INPUT',
  // A `take` above the list's `maxTake`.
  KS_LIMITS_EXCEEDED: 'INVALID_INPUT',
  // The message lists one error for each field, and `extensions.debug` holds their messages.
  KS_EXTENSION_ERROR: 'FIELD_ERRORS',
  KS_RESOLVER_ERROR: 'FIELD_ERRORS',
  KS_RELATIONSHIP_ERROR: 'FIELD_ERRORS',
  // An access function of the app returned a value that is not a boolean.
  KS_ACCESS_RETURN_ERROR: 'SERVER_ERROR',
  KS_PRISMA_ERROR: 'SERVER_ERROR',
};

/**
 * Maps a rejection from `graphql.run` to a neutral code. The message is kept when it helps the agent fix the call
 * and names no technology; `message: undefined` means that the agent gets the fixed message of the code.
 * Access-denied and invalid-input messages are kept. Every other error, including an error that the database
 * caused, an unknown code and an error without a code, is a `SERVER_ERROR` without its message.
 */
function neutralError(error: unknown): { code: ErrorCode; message: string | undefined } {
  if (!(error instanceof GraphQLError)) return { code: 'SERVER_ERROR', message: undefined };
  const code = neutralCode(error);
  let message: string | undefined;
  if (code !== 'SERVER_ERROR') {
    const variable = badUserInputVariable(error);
    // The agent passes arguments; `callTool` turns each argument into a variable of the same name.
    message = variable === undefined ? error.message : error.message.replace(`Variable "$${variable}"`, `Argument "${variable}"`);
  }
  return { code, message: message !== undefined && TECHNOLOGY.test(message) ? undefined : message };
}

function neutralCode(error: GraphQLError): ErrorCode {
  const code = error.extensions.code;
  if (code === undefined) return badUserInputVariable(error) === undefined ? 'SERVER_ERROR' : 'INVALID_INPUT';
  if (code === 'BAD_USER_INPUT') return 'INVALID_INPUT';
  const keystone = typeof code === 'string' ? KEYSTONE_CODES[code] : undefined;
  if (keystone !== 'FIELD_ERRORS') return keystone ?? 'SERVER_ERROR';
  // A list of field errors is denied access or invalid input only when every field error is.
  const debug = error.extensions.debug;
  const messages = Array.isArray(debug) ? debug.map((entry: { message?: unknown } | null) => entry?.message) : [];
  const all = (prefix: string) => messages.length > 0 && messages.every((m) => typeof m === 'string' && m.startsWith(prefix));
  if (all('Access denied: ')) return 'ACCESS_DENIED';
  if (all('Input error: ')) return 'INVALID_INPUT';
  return 'SERVER_ERROR';
}

/** The variable name of an error from variable coercion, by Apollo Server's test in `isBadUserInputGraphQLError`. */
function badUserInputVariable(error: GraphQLError): string | undefined {
  const node = error.nodes?.length === 1 ? error.nodes[0] : undefined;
  if (node?.kind !== Kind.VARIABLE_DEFINITION) return undefined;
  const name = node.variable.name.value;
  const variable = `Variable "$${name}"`;
  const coercion = [' has invalid value', ' got invalid value ', ' of required type ', ' of non-null type '].some((rest) =>
    error.message.startsWith(variable + rest),
  );
  return coercion ? name : undefined;
}
