/**
 * Searching a vault nobody else can read.
 *
 * The obvious approach for encrypted search is searchable symmetric
 * encryption: the client builds an encrypted index, the server matches
 * blindly. We are not doing that, and the reason is worth writing down.
 *
 * SSE exists because the corpus is too large to hold on the client. A personal
 * vault is not that — it is hundreds of short memories, and a 1 KB thought
 * decrypts in 0.3 ms (docs/paper/benchmarks.md §2). So the client can simply
 * decrypt everything and search in memory, which leaks *nothing*: no query, no
 * index, no access pattern over the index. Every SSE scheme leaks some of
 * that, and the published attacks on those leakage profiles are the reason to
 * avoid buying a weaker property for a problem we do not have.
 *
 * The functions here are the matching half, kept pure so they can be tested
 * without a vault. Decryption and caching live in the component, where the key
 * is — and plaintext never leaves that memory: it is not written to
 * localStorage, sessionStorage or IndexedDB, so closing the tab ends it.
 */

/** A decrypted memory, held only for the life of the tab. */
export type SearchableMemory = {
  id: string;
  createdAt: string;
  /** Null for audio, which has no transcript to search. */
  text: string | null;
};

export type SearchHit = {
  id: string;
  createdAt: string;
  /** The matched text split for highlighting, so the UI never builds HTML. */
  before: string;
  match: string;
  after: string;
};

/** Casefold and collapse whitespace so a line break cannot hide a match. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ');
}

const WINDOW = 70;

/**
 * One result per memory, from the first match in it.
 *
 * Deliberately first-match-only: a count of hits inside a memory would be a
 * relevance score, and ranking someone's grief by keyword frequency is not a
 * thing this product should do. Results stay in vault order — newest first,
 * the same order the timeline uses — so the list never reorders under you.
 */
export function matchMemories(memories: SearchableMemory[], query: string): SearchHit[] {
  const needle = normalise(query.trim());
  if (!needle) return [];

  const hits: SearchHit[] = [];

  for (const memory of memories) {
    if (!memory.text) continue;

    const haystack = normalise(memory.text);
    const at = haystack.indexOf(needle);
    if (at === -1) continue;

    // Index into the normalised string, then slice the original: collapsing
    // whitespace can shorten the text, so slicing the original at a normalised
    // offset would drift. Re-finding in the original is the honest fix.
    const original = memory.text;
    const originalAt = findInOriginal(original, needle, at);
    if (originalAt === -1) continue;

    const start = Math.max(0, originalAt - WINDOW);
    const end = Math.min(original.length, originalAt + needle.length + WINDOW);

    hits.push({
      id: memory.id,
      createdAt: memory.createdAt,
      before: (start > 0 ? '…' : '') + original.slice(start, originalAt),
      match: original.slice(originalAt, originalAt + needle.length),
      after: original.slice(originalAt + needle.length, end) + (end < original.length ? '…' : ''),
    });
  }

  return hits;
}

/**
 * Locate a normalised match back in the original text.
 *
 * Walks both strings together, counting only the characters that survive
 * normalisation, so the returned offset is a real index into the original even
 * when runs of whitespace collapsed on the way.
 */
function findInOriginal(original: string, needle: string, normalisedAt: number): number {
  let seen = 0;
  let previousWasSpace = false;

  for (let i = 0; i < original.length; i += 1) {
    if (seen === normalisedAt) {
      // Confirm it really is the match, rather than trusting the arithmetic.
      if (normalise(original.slice(i, i + needle.length * 2)).startsWith(needle)) return i;
    }

    const isSpace = /\s/.test(original[i]!);
    if (isSpace) {
      if (!previousWasSpace) seen += 1;
      previousWasSpace = true;
    } else {
      seen += 1;
      previousWasSpace = false;
    }
  }

  return -1;
}

/** How many memories can be searched at all, for an honest empty state. */
export function searchableCount(memories: SearchableMemory[]): number {
  return memories.filter((memory) => memory.text !== null).length;
}
