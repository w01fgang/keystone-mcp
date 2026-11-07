import type { Catalog, CatalogEntry } from './types.js';

export interface InstructionsOptions {
  /** The app author's paragraph about the project, from the `instructions` option. It comes first. */
  about?: string;
  /** When `false`, the text says that searchTool is off. */
  introspection: boolean;
}

/** One kind of record and the names of its one-record operations. */
interface RecordKind {
  /** The kind in plain words, from the name of its many-record query, for example `order lines`. */
  words: string;
  read: string;
  create?: string;
  update?: string;
  delete?: string;
}

/**
 * Builds the server instructions that `initialize` sends: the author's paragraph, then a part built from the
 * catalog that names the kinds of records and their one-record operations. The text names no technology.
 */
export function buildInstructions(catalog: Catalog, { about, introspection }: InstructionsOptions): string {
  const kinds = recordKinds(catalog);
  const lines: string[] = [];
  if (kinds.length > 0) lines.push(`This project holds these kinds of records: ${kinds.map((kind) => kind.words).join(', ')}.`);
  lines.push("You act as the signed-in user. The project's access rules decide what you can read and change.");
  lines.push(
    introspection
      ? 'Search first, then call: searchTool finds an operation and shows its arguments and field paths, and callTool runs it by name.'
      : 'searchTool is off in this project. callTool runs an operation by name, for example one of the operations below.',
  );
  if (kinds.length > 0) {
    lines.push('The operations for one record of each kind:');
    for (const kind of kinds) {
      const verbs = (['read', 'create', 'update', 'delete'] as const).filter((verb) => kind[verb]);
      lines.push(`- ${kind.words}: ${verbs.map((verb) => `${verb} ${kind[verb]}`).join(', ')}.`);
    }
    lines.push('Read, update and delete find the record by where: { id }.');
    const update = kinds.find((kind) => kind.update)?.update;
    const remove = kinds.find((kind) => kind.delete)?.delete;
    lines.push(`Read one record: callTool { operation: "${kinds[0]!.read}", args: { where: { id } }, select: [...] }.`);
    if (update) lines.push(`Update one record: callTool { operation: "${update}", args: { where: { id }, data: { ... } } }.`);
    if (remove) lines.push(`Delete one record: callTool { operation: "${remove}", args: { where: { id } } }.`);
  }
  const generated = lines.join('\n');
  return about ? `${about}\n\n${generated}` : generated;
}

/**
 * Finds the kinds of records by the shape of their operations, in catalog order. A kind is a type `T` with a query
 * `(where: TWhereUniqueInput!): T`. Its words come from the query `(where: TWhereInput!, ...): [T!]`.
 */
function recordKinds(catalog: Catalog): RecordKind[] {
  const kinds: RecordKind[] = [];
  for (const entry of catalog.entries) {
    if (entry.kind !== 'query' || !hasArgs(entry, { where: `${entry.returnType}WhereUniqueInput!` })) continue;
    const type = entry.returnType;
    const many = catalog.entries.find(
      (other) =>
        other.kind === 'query' &&
        other.returnType === `[${type}!]` &&
        other.args.some((arg) => arg.name === 'where' && arg.type === `${type}WhereInput!`),
    );
    const mutation = (args: Record<string, string>) =>
      catalog.entries.find((other) => other.kind === 'mutation' && other.returnType === type && hasArgs(other, args))?.name;
    const create = mutation({ data: `${type}CreateInput!` });
    const update = mutation({ where: `${type}WhereUniqueInput!`, data: `${type}UpdateInput!` });
    const remove = mutation({ where: `${type}WhereUniqueInput!` });
    kinds.push({
      // `orderLines` becomes `order lines`.
      words: (many?.name ?? type).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase(),
      read: entry.name,
      ...(create ? { create } : {}),
      ...(update ? { update } : {}),
      ...(remove ? { delete: remove } : {}),
    });
  }
  return kinds;
}

/** `true` when the entry has exactly these arguments, by name and type. */
function hasArgs(entry: CatalogEntry, args: Record<string, string>): boolean {
  const names = Object.keys(args);
  return entry.args.length === names.length && names.every((name) => entry.args.some((arg) => arg.name === name && arg.type === args[name]));
}
