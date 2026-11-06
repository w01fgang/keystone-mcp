import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../src/catalog.js';
import type { InputSummary } from '../src/types.js';
import { schema } from './schema.js';

const catalog = buildCatalog(schema);
const field = (inputs: InputSummary[] | undefined, name: string) => inputs?.find((input) => input.name === name);

describe('buildCatalog', () => {
  it('lists the query and mutation root fields without the keystone meta field', () => {
    expect(catalog.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'query:posts',
      'query:post',
      'query:postsCount',
      'query:users',
      'query:user',
      'mutation:createPost',
      'mutation:updatePost',
      'mutation:deletePost',
    ]);
    expect(catalog.byName.has('keystone')).toBe(false);
  });

  it('leaves mutations out when queriesOnly is set', () => {
    const queries = buildCatalog(schema, { queriesOnly: true });
    expect(queries.entries.every((entry) => entry.kind === 'query')).toBe(true);
    expect(queries.byName.has('createPost')).toBe(false);
  });

  it('describes argument signatures with SDL types and default values', () => {
    const posts = catalog.byName.get('posts')!;
    expect(posts.description).toBe('Read many posts.');
    expect(posts.returnType).toBe('[Post!]');
    expect(posts.args.map(({ name, type, defaultValue }) => ({ name, type, defaultValue }))).toEqual([
      { name: 'where', type: 'PostWhereInput!', defaultValue: '{}' },
      { name: 'orderBy', type: '[PostOrderByInput!]!', defaultValue: '[]' },
      { name: 'take', type: 'Int', defaultValue: undefined },
      { name: 'skip', type: 'Int!', defaultValue: '0' },
      { name: 'cursor', type: 'PostWhereUniqueInput', defaultValue: undefined },
    ]);
  });

  it('walks input types two levels and stops there', () => {
    const where = field(catalog.byName.get('posts')!.args, 'where');
    const title = field(where?.fields, 'title');
    expect(title?.type).toBe('StringFilter');
    const not = field(title?.fields, 'not');
    expect(not?.type).toBe('NestedStringFilter');
    expect(not?.fields).toBeUndefined();
    const author = field(where?.fields, 'author');
    expect(author?.fields?.map((input) => input.name)).toEqual(['id', 'name']);
  });

  it('omits AND, OR, NOT and many-relationship filters from input summaries', () => {
    const where = field(catalog.byName.get('users')!.args, 'where');
    expect(where?.fields?.map((input) => input.name)).toEqual(['id', 'name']);
  });

  it('lists scalar and enum paths plus one level below object fields', () => {
    expect(catalog.byName.get('posts')!.paths).toEqual([
      'id',
      'title',
      'status',
      'author.id',
      'author.name',
      'author.email',
      'author.postsCount',
      'tags',
      'content.document',
      'content.wordCount',
    ]);
  });

  it('skips an output field with a required argument that has no default', () => {
    expect(catalog.byName.get('post')!.paths).not.toContain('excerpt');
  });

  it('marks a scalar return type as a leaf with no paths', () => {
    const count = catalog.byName.get('postsCount')!;
    expect(count.leaf).toBe(true);
    expect(count.paths).toEqual([]);
    expect(catalog.byName.get('posts')!.leaf).toBe(false);
  });
});
