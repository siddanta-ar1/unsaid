import { describe, expect, it } from 'vitest';
import { matchMemories, searchableCount, type SearchableMemory } from './search';

/**
 * The matching half of vault search. Decryption is the component's job; these
 * tests are about whether a person finds the thing they half-remember writing.
 */

function memory(id: string, text: string | null): SearchableMemory {
  return { id, createdAt: '2026-10-10T09:00:00.000Z', text };
}

describe('finding a memory again', () => {
  it('finds a word regardless of the case it was written in', () => {
    const hits = matchMemories([memory('a', 'I was Furious and could not say it')], 'furious');

    expect(hits).toHaveLength(1);
    expect(hits[0]!.match).toBe('Furious');
  });

  it('returns the words around the match, so the row is recognisable', () => {
    const hits = matchMemories(
      [memory('a', 'nothing about today went the way I wanted it to go')],
      'went',
    );

    expect(hits[0]!.before).toContain('today');
    expect(hits[0]!.after).toContain('way');
  });

  it('matches across a line break, which is where people actually break sentences', () => {
    const hits = matchMemories([memory('a', 'I am\n   so tired')], 'am so tired');

    expect(hits).toHaveLength(1);
  });

  it('keeps the match aligned with the original text after whitespace collapses', () => {
    // The offset is found in the normalised string; slicing the original at
    // that offset would drift by exactly the number of characters the collapse
    // removed. This is the regression that guards it.
    const text = 'a     b     c     needle here';
    const hits = matchMemories([memory('a', text)], 'needle');

    expect(hits[0]!.match).toBe('needle');
    expect(hits[0]!.after.startsWith(' here')).toBe(true);
  });

  it('marks where the text was cut, so a snippet is never mistaken for the whole memory', () => {
    const long = `${'padding word '.repeat(20)}target${' trailing word'.repeat(20)}`;
    const hits = matchMemories([memory('a', long)], 'target');

    expect(hits[0]!.before.startsWith('…')).toBe(true);
    expect(hits[0]!.after.endsWith('…')).toBe(true);
  });

  it('reports one hit per memory, not one per occurrence', () => {
    // Counting occurrences would be a relevance score, and ranking what
    // someone wrote by keyword frequency is not something this product does.
    const hits = matchMemories([memory('a', 'sorry sorry sorry')], 'sorry');

    expect(hits).toHaveLength(1);
  });

  it('keeps results in vault order rather than reordering by relevance', () => {
    const hits = matchMemories(
      [memory('first', 'a quiet day'), memory('second', 'quiet again')],
      'quiet',
    );

    expect(hits.map((hit) => hit.id)).toEqual(['first', 'second']);
  });
});

describe('what cannot be searched', () => {
  it('skips voice memories instead of pretending they have no match', () => {
    const memories = [memory('spoken', null), memory('written', 'the same word')];

    expect(matchMemories(memories, 'word').map((hit) => hit.id)).toEqual(['written']);
    expect(searchableCount(memories)).toBe(1);
  });

  it('returns nothing for an empty query rather than every memory', () => {
    expect(matchMemories([memory('a', 'anything at all')], '   ')).toEqual([]);
  });
});
