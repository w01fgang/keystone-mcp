import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../src/catalog.js';
import { buildInstructions } from '../src/instructions.js';
import { schema } from './schema.js';

describe('buildInstructions', () => {
  it('names each kind of record with the one-record operations that the catalog has', () => {
    const text = buildInstructions(buildCatalog(schema), { introspection: true });
    expect(text).toContain('records: posts, users.');
    expect(text).toContain('- posts: read post, create createPost, update updatePost, delete deletePost.');
    expect(text).toContain('- users: read user.');
  });

  it('starts with the author paragraph, before the generated part', () => {
    const text = buildInstructions(buildCatalog(schema), { about: 'A blog about cats.', introspection: true });
    expect(text.startsWith('A blog about cats.\n\nThis project holds')).toBe(true);
  });

  it('keeps the generated part and says that searchTool is off when introspection is off', () => {
    const text = buildInstructions(buildCatalog(schema), { introspection: false });
    expect(text).toContain('- posts: read post, create createPost, update updatePost, delete deletePost.');
    expect(text).toContain('searchTool is off');
    expect(text).not.toContain('Search first');
  });

  it('lists read operations only when the catalog holds queries only', () => {
    const text = buildInstructions(buildCatalog(schema, { queriesOnly: true }), { introspection: true });
    expect(text).toContain('- posts: read post.');
    expect(text).not.toMatch(/createPost|updatePost|deletePost/);
  });
});
