import { CallError, type Catalog, type CatalogEntry } from './types.js';

export interface CallInput {
  /** The name of a catalog entry, for example `posts`. */
  operation: string;
  /** Argument values by argument name. They become GraphQL variables. */
  args?: Record<string, unknown>;
  /** Field paths from the catalog entry. Default: the top-level paths of the entry. */
  select?: string[];
}

export interface Call {
  entry: CatalogEntry;
  document: string;
  variables: Record<string, unknown>;
}

/** The name of the `take` argument that Keystone list queries accept. */
const TAKE_ARG = 'take';

/**
 * Turns one catalog entry and the input of `callTool` into a GraphQL document and its variables.
 * When the operation has a `take` argument, `take` is at most `takeLimit` rows in either direction, and a missing `take` is `takeLimit`.
 * Throws `CallError` when the catalog rejects the input.
 */
export function buildCall(catalog: Catalog, input: CallInput, takeLimit: number): Call {
  const entry = catalog.byName.get(input.operation);

  if (!entry) {
    throw new CallError(`Unknown operation "${input.operation}". Use searchTool to find the name of an operation.`);
  }

  const variables = buildVariables(entry, input.args ?? {}, takeLimit);
  const declared = entry.args.filter((arg) => arg.name in variables);
  const variableList = declared.map((arg) => `$${arg.name}: ${arg.type}`).join(', ');
  const argumentList = declared.map((arg) => `${arg.name}: $${arg.name}`).join(', ');

  const document = [
    entry.kind,
    ' KeystoneMcpCall',
    variableList ? `(${variableList})` : '',
    ' { ',
    entry.name,
    argumentList ? `(${argumentList})` : '',
    buildSelection(entry, input.select),
    ' }',
  ].join('');

  return { entry, document, variables };
}

function buildVariables(entry: CatalogEntry, args: Record<string, unknown>, takeLimit: number) {
  const known = new Set(entry.args.map((arg) => arg.name));
  const unknown = Object.keys(args).filter((name) => !known.has(name));

  if (unknown.length > 0) {
    throw new CallError(
      `Operation "${entry.name}" has no argument ${unknown.map((name) => `"${name}"`).join(', ')}. ` +
        `Its arguments are: ${[...known].join(', ') || 'none'}.`,
    );
  }

  const variables = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));

  if (known.has(TAKE_ARG)) {
    const take = variables[TAKE_ARG];

    if (take === null || take === undefined) {
      variables[TAKE_ARG] = takeLimit;
    } else if (typeof take === 'number' && Math.abs(take) > takeLimit) {
      // A negative take reads rows from the end. Keystone limits it by its absolute value too.
      variables[TAKE_ARG] = Math.sign(take) * takeLimit;
    }
  }

  const missing = entry.args.filter(
    (arg) => arg.type.endsWith('!') && arg.defaultValue === undefined && variables[arg.name] == null,
  );

  if (missing.length > 0) {
    throw new CallError(
      `Operation "${entry.name}" needs the argument ${missing.map((arg) => `"${arg.name}: ${arg.type}"`).join(', ')}.`,
    );
  }

  return variables;
}

/** Builds the selection set, for example ` { id author { name } }`, from field paths. */
function buildSelection(entry: CatalogEntry, select: string[] | undefined): string {
  if (entry.leaf) {
    if (select && select.length > 0) {
      throw new CallError(`Operation "${entry.name}" returns ${entry.returnType}, which has no fields. Omit select.`);
    }

    return '';
  }

  const paths = select && select.length > 0 ? select : entry.paths.filter((path) => !path.includes('.'));

  if (paths.length === 0) {
    throw new CallError(`Operation "${entry.name}" returns ${entry.returnType}, which has no selectable paths.`);
  }

  const allowed = new Set(entry.paths);
  const unknown = paths.filter((path) => !allowed.has(path));

  if (unknown.length > 0) {
    throw new CallError(
      `Operation "${entry.name}" has no field path ${unknown.map((path) => `"${path}"`).join(', ')}. ` +
        'Use searchTool to see its paths.',
    );
  }

  const fields = new Map<string, Set<string>>();

  for (const path of paths) {
    const [field, child] = path.split('.') as [string, string | undefined];
    const children = fields.get(field) ?? new Set<string>();

    if (child) children.add(child);
    fields.set(field, children);
  }

  const parts = [...fields].map(([field, children]) =>
    children.size > 0 ? `${field} { ${[...children].join(' ')} }` : field,
  );

  return ` { ${parts.join(' ')} }`;
}
