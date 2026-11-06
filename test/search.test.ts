import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../src/catalog.js';
import { searchCatalog } from '../src/search.js';
import type { Catalog } from '../src/types.js';
import { schema } from './schema.js';

const catalog = buildCatalog(schema);
const names = (text: string, limit?: number, from: Catalog = catalog) =>
  searchCatalog(from, { text, limit }).map((entry) => entry.name);

describe('searchCatalog', () => {
  it('ranks the exact name first and returns its signatures and paths', () => {
    const [first] = searchCatalog(catalog, { text: 'posts' });
    expect(first?.name).toBe('posts');
    expect(first?.args.map((arg) => arg.name)).toEqual(['where', 'orderBy', 'take', 'skip', 'cursor']);
    expect(first?.paths).toContain('author.name');
  });

  it('matches the return type, the description and field paths', () => {
    expect(names('Post')).toEqual(expect.arrayContaining(['post', 'createPost', 'deletePost']));
    expect(names('read many')).toEqual(['posts']);
    expect(names('wordCount')).toEqual(['posts', 'post', 'createPost', 'updatePost', 'deletePost']);
  });

  it('returns nothing when no word matches', () => {
    expect(names('invoice')).toEqual([]);
  });

  it('returns the first entries for text without words', () => {
    expect(names('  ', 2)).toEqual(['posts', 'post']);
  });

  it('returns 10 entries by default and at most 25', () => {
    const fields = Array.from({ length: 30 }, (_, i) => ({
      name: `op${i}`,
      kind: 'query' as const,
      returnType: 'Int',
      args: [],
      paths: [],
      leaf: true,
    }));
    const big: Catalog = { entries: fields, byName: new Map(fields.map((entry) => [entry.name, entry])) };
    expect(names('op', undefined, big)).toHaveLength(10);
    expect(names('op', 100, big)).toHaveLength(25);
    expect(names('op', 0, big)).toHaveLength(1);
  });
});
