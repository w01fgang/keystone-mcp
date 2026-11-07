import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GraphQLSchema } from 'graphql';

/** Options that the app author passes to `keystoneMcp()`. */
export interface KeystoneMcpOptions {
  /** The HTTP path of the MCP endpoint. Default: `/mcp`. */
  path?: string;
  /** When `true`, the catalog holds queries only, and `callTool` cannot run mutations. Default: `false`. */
  queriesOnly?: boolean;
  /** The maximum value of the `take` argument that `callTool` sends. Default: `50`. */
  takeLimit?: number;
  /**
   * When `false`, `searchTool` returns a tool error and no catalog. `callTool` keeps working.
   * Default: `true`, except when `NODE_ENV` is `production`, as Apollo Server's `introspection` default.
   */
  introspection?: boolean;
  /**
   * One paragraph about the project, in the author's words. The server instructions start with it, before the part
   * that the package builds from the catalog. Default: none.
   */
  instructions?: string;
  /**
   * A random string of 32 characters or more. With it, OAuth clients, sign-ins, codes and tokens are sealed values that
   * any process with the same secret opens, so sign-ins survive a restart and work across processes. Default: none;
   * sign-ins then live in the memory of the process and end at restart.
   */
  secret?: string;
}

export interface ResolvedOptions {
  path: string;
  queriesOnly: boolean;
  takeLimit: number;
  introspection: boolean;
  instructions: string | undefined;
  secret: string | undefined;
}

/** A value that JSON carries: tool arguments, GraphQL variables and GraphQL results. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/** A JSON object, for example the variables of one GraphQL operation or the data that it returns. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * The part of the Keystone context that this package uses.
 * A Keystone 6 `KeystoneContext` satisfies this interface.
 */
export interface McpContext {
  graphql: {
    schema: GraphQLSchema;
    run(args: { query: string; variables?: JsonObject }): Promise<JsonObject>;
  };
  /** The session of a request context. `/mcp` refuses a request whose access token has no Keystone session. */
  session?: unknown;
  withRequest(req: IncomingMessage, res?: ServerResponse): Promise<McpContext>;
}

export type OperationKind = 'query' | 'mutation';

/** One input field or argument, with its type in SDL notation, for example `PostWhereInput!`. */
export interface InputSummary {
  name: string;
  type: string;
  description?: string;
  /** The default value in GraphQL literal notation, for example `{}`. */
  defaultValue?: string;
  /** The fields of an input object type, two levels deep from the argument. */
  fields?: InputSummary[];
}

/** One root field of the query or mutation type. */
export interface CatalogEntry {
  name: string;
  kind: OperationKind;
  description?: string;
  /** The return type in SDL notation, for example `[Post!]`. */
  returnType: string;
  args: InputSummary[];
  /** Selectable field paths, for example `title` and `author.name`. Empty when the return type is a leaf. */
  paths: string[];
  /** `true` when the return type is a scalar or an enum, so the call has no selection set. */
  leaf: boolean;
}

export interface Catalog {
  entries: CatalogEntry[];
  byName: Map<string, CatalogEntry>;
}

/** A request that the catalog rejects. The MCP server returns its message as a tool error. */
export class CallError extends Error {
  override name = 'CallError';
}
