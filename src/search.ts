import type { Catalog, CatalogEntry } from './types.js';

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 25;

export interface SearchInput {
  /** Free text. Each word scores against the name, description, return type and field paths. */
  text: string;
  /** The number of entries to return. Default: 10. Maximum: 25. */
  limit?: number;
}

/** Points for one word, by where it matches. */
const SCORE = {
  exactName: 10,
  name: 5,
  returnType: 3,
  description: 2,
  path: 1,
};

/**
 * Returns the catalog entries that best match the text, highest score first.
 * Entries with the same score keep catalog order. Text with no words returns the first entries.
 */
export function searchCatalog(catalog: Catalog, input: SearchInput): CatalogEntry[] {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_SEARCH_LIMIT), 1), MAX_SEARCH_LIMIT);
  const words = input.text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  if (words.length === 0) return catalog.entries.slice(0, limit);
  return catalog.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, words) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

function scoreEntry(entry: CatalogEntry, words: string[]): number {
  const name = entry.name.toLowerCase();
  const returnType = entry.returnType.toLowerCase();
  const description = entry.description?.toLowerCase() ?? '';
  const paths = entry.paths.map((path) => path.toLowerCase());
  let score = 0;
  for (const word of words) {
    if (name === word) score += SCORE.exactName;
    else if (name.includes(word)) score += SCORE.name;
    if (returnType.includes(word)) score += SCORE.returnType;
    if (description.includes(word)) score += SCORE.description;
    if (paths.some((path) => path.includes(word))) score += SCORE.path;
  }
  return score;
}
