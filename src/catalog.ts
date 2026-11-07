import {
  astFromValue,
  getNamedType,
  isInputObjectType,
  isInterfaceType,
  isLeafType,
  isNonNullType,
  isObjectType,
  print,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputField,
  type GraphQLNamedType,
  type GraphQLObjectType,
  type GraphQLSchema,
} from 'graphql';
import type { Catalog, CatalogEntry, InputSummary, OperationKind } from './types.js';

/** The root field that Keystone adds for the Admin UI. It is not an operation for an MCP client. */
const KEYSTONE_META_FIELD = 'keystone';

/** Logical combinators. They repeat the whole filter, so a summary omits them. */
const COMBINATOR_FIELDS = ['AND', 'OR', 'NOT'];

/** Fields that mark a many-relationship filter. A summary omits an input object with any of them. */
const MANY_RELATION_FIELDS = ['every', 'some', 'none'];

/** Input-type summaries stop after this many levels below the argument. */
const INPUT_DEPTH = 2;

export interface CatalogOptions {
  queriesOnly?: boolean;
}

/** Builds the operation catalog from the query and mutation roots of a schema. */
export function buildCatalog(schema: GraphQLSchema, options: CatalogOptions = {}): Catalog {
  const entries: CatalogEntry[] = [];
  const byName = new Map<string, CatalogEntry>();

  const roots: [OperationKind, GraphQLObjectType | null | undefined][] = [
    ['query', schema.getQueryType()],
    ['mutation', options.queriesOnly ? undefined : schema.getMutationType()],
  ];

  for (const [kind, root] of roots) {
    if (!root) continue;

    for (const field of Object.values(root.getFields())) {
      if (field.name === KEYSTONE_META_FIELD) continue;

      // callTool finds an operation by name. A mutation that repeats a query name stays out.
      if (byName.has(field.name)) continue;
      const entry = buildEntry(kind, field);
      entries.push(entry);
      byName.set(entry.name, entry);
    }
  }

  return { entries, byName };
}

function buildEntry(kind: OperationKind, field: GraphQLField<unknown, unknown>): CatalogEntry {
  const returnType = getNamedType(field.type);

  return {
    name: field.name,
    kind,
    // `JSON.stringify` skips an `undefined` description, so a search result lists it only when the field has one.
    description: field.description || undefined,
    returnType: String(field.type),
    args: field.args.map((arg) => summarizeInput(arg, 1)),
    paths: selectablePaths(returnType),
    leaf: isLeafType(returnType),
  };
}

function summarizeInput(input: GraphQLArgument | GraphQLInputField, depth: number): InputSummary {
  const summary: InputSummary = { name: input.name, type: String(input.type) };

  if (input.description) summary.description = input.description;

  if (input.defaultValue !== undefined) {
    const ast = astFromValue(input.defaultValue, input.type);

    if (ast) summary.defaultValue = print(ast);
  }

  if (depth <= INPUT_DEPTH) {
    const fields = summarizeInputFields(getNamedType(input.type), depth);

    if (fields) summary.fields = fields;
  }

  return summary;
}

function summarizeInputFields(type: GraphQLNamedType, depth: number): InputSummary[] | undefined {
  if (!isInputObjectType(type)) return undefined;

  return Object.values(type.getFields())
    .filter((field) => !COMBINATOR_FIELDS.includes(field.name) && !isManyRelationFilter(getNamedType(field.type)))
    .map((field) => summarizeInput(field, depth + 1));
}

function isManyRelationFilter(type: GraphQLNamedType): boolean {
  if (!isInputObjectType(type)) return false;
  const fields = type.getFields();

  return MANY_RELATION_FIELDS.some((name) => name in fields);
}

/**
 * The scalar and enum fields of the return type, plus one level of scalar and enum fields
 * on its object fields. A field with a required argument that has no default is not a path.
 */
function selectablePaths(type: GraphQLNamedType): string[] {
  const paths: string[] = [];

  for (const field of selectableFields(type)) {
    const named = getNamedType(field.type);

    if (isLeafType(named)) {
      paths.push(field.name);
      continue;
    }

    for (const child of selectableFields(named)) {
      if (isLeafType(getNamedType(child.type))) paths.push(`${field.name}.${child.name}`);
    }
  }

  return paths;
}

function selectableFields(type: GraphQLNamedType): GraphQLField<unknown, unknown>[] {
  if (!isObjectType(type) && !isInterfaceType(type)) return [];

  return Object.values(type.getFields()).filter(
    (field) => !field.args.some((arg) => isNonNullType(arg.type) && arg.defaultValue === undefined),
  );
}
