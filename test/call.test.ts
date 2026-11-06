import { parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import { buildCall } from '../src/call.js';
import { buildCatalog } from '../src/catalog.js';
import { CallError } from '../src/types.js';
import { schema } from './schema.js';

const catalog = buildCatalog(schema);
const expectValid = (document: string) => expect(validate(schema, parse(document))).toEqual([]);

describe('buildCall', () => {
  it('builds a valid query with variables and the selected paths', () => {
    const call = buildCall(
      catalog,
      { operation: 'posts', args: { where: { title: { contains: 'mcp' } }, take: 5 }, select: ['id', 'author.name', 'author.email', 'title'] },
      50,
    );
    expect(call.document).toBe(
      'query KeystoneMcpCall($where: PostWhereInput!, $take: Int) { posts(where: $where, take: $take) { id author { name email } title } }',
    );
    expect(call.variables).toEqual({ where: { title: { contains: 'mcp' } }, take: 5 });
    expectValid(call.document);
  });

  it('clamps take to takeLimit', () => {
    const call = buildCall(catalog, { operation: 'posts', args: { take: 80 } }, 50);
    expect(call.variables.take).toBe(50);
    expectValid(call.document);
  });

  it('clamps a negative take to -takeLimit, so it still returns at most takeLimit rows', () => {
    expect(buildCall(catalog, { operation: 'posts', args: { take: -80 } }, 50).variables.take).toBe(-50);
    expect(buildCall(catalog, { operation: 'posts', args: { take: -5 } }, 50).variables.take).toBe(-5);
  });

  it('sends takeLimit when take is missing or null', () => {
    expect(buildCall(catalog, { operation: 'posts' }, 50).variables).toEqual({ take: 50 });
    expect(buildCall(catalog, { operation: 'users', args: { take: null } }, 7).variables).toEqual({ take: 7 });
  });

  it('selects the top-level paths when select is missing', () => {
    const call = buildCall(catalog, { operation: 'post', args: { where: { id: '1' } } }, 50);
    expect(call.document).toBe('query KeystoneMcpCall($where: PostWhereUniqueInput!) { post(where: $where) { id title status tags } }');
    expectValid(call.document);
  });

  it('builds a mutation', () => {
    const call = buildCall(catalog, { operation: 'createPost', args: { data: { title: 'Hello' } }, select: ['id'] }, 50);
    expect(call.document).toBe('mutation KeystoneMcpCall($data: PostCreateInput!) { createPost(data: $data) { id } }');
    expectValid(call.document);
  });

  it('builds a leaf operation without a selection set', () => {
    const call = buildCall(catalog, { operation: 'postsCount' }, 50);
    expect(call.document).toBe('query KeystoneMcpCall { postsCount }');
    expectValid(call.document);
    expect(() => buildCall(catalog, { operation: 'postsCount', select: ['id'] }, 50)).toThrow(/Omit select/);
  });

  it('rejects an unknown operation and names searchTool', () => {
    expect(() => buildCall(catalog, { operation: 'invoices' }, 50)).toThrow(CallError);
    expect(() => buildCall(catalog, { operation: 'invoices' }, 50)).toThrow(/searchTool/);
  });

  it('rejects an unknown field path', () => {
    expect(() => buildCall(catalog, { operation: 'posts', select: ['excerpt'] }, 50)).toThrow(/no field path "excerpt"/);
    expect(() => buildCall(catalog, { operation: 'posts', select: ['author'] }, 50)).toThrow(CallError);
  });

  it('rejects an unknown argument', () => {
    expect(() => buildCall(catalog, { operation: 'post', args: { id: '1' } }, 50)).toThrow(/no argument "id"/);
  });

  it('rejects a call without a required argument', () => {
    expect(() => buildCall(catalog, { operation: 'post' }, 50)).toThrow(/needs the argument "where: PostWhereUniqueInput!"/);
  });

  it('cannot call a mutation from a queriesOnly catalog', () => {
    const queries = buildCatalog(schema, { queriesOnly: true });
    expect(() => buildCall(queries, { operation: 'createPost', args: { data: {} } }, 50)).toThrow(/Unknown operation/);
  });
});
