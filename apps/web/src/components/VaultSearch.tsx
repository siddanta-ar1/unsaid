'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { ThoughtMetadata } from '@unsaid/types';
import { openThought } from '@/lib/thoughts';
import { matchMemories, searchableCount, type SearchHit, type SearchableMemory } from '@/lib/search';

/**
 * Search, done on the device.
 *
 * A vault you cannot search is a vault people stop opening, and this was the
 * largest functional gap in the product: there was no way to find anything you
 * had written.
 *
 * Reading is explicit rather than automatic. Searching means decrypting every
 * written memory, and while that costs nothing in CPU terms it does mean the
 * server sees this vault download all of its objects — an access pattern it
 * would not otherwise observe. So the user presses a button that says what it
 * is about to do, rather than having it happen because they clicked into a
 * text field.
 *
 * Decrypted text lives in a ref for the life of the tab and is written to no
 * storage of any kind. Closing the tab is the end of it.
 */
export function VaultSearch({ thoughts, token, vaultKey }: {
  thoughts: ThoughtMetadata[];
  token: string;
  vaultKey: CryptoKey;
}) {
  const cache = useRef<SearchableMemory[] | null>(null);
  const [state, setState] = useState<'cold' | 'reading' | 'ready' | 'failed'>('cold');
  const [progress, setProgress] = useState(0);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  const textCount = thoughts.filter((thought) => thought.type !== 'audio').length;

  async function prepare() {
    setState('reading');
    setProgress(0);

    try {
      const memories: SearchableMemory[] = [];

      for (const [index, thought] of thoughts.entries()) {
        if (thought.type === 'audio') {
          memories.push({ id: thought.id, createdAt: thought.createdAt, text: null });
        } else {
          const { bytes } = await openThought(thought.id, token, vaultKey);
          memories.push({
            id: thought.id,
            createdAt: thought.createdAt,
            text: new TextDecoder().decode(bytes),
          });
        }
        setProgress(index + 1);
      }

      cache.current = memories;
      setState('ready');
      if (query.trim()) setHits(matchMemories(memories, query));
    } catch {
      setState('failed');
    }
  }

  function onQueryChange(value: string) {
    setQuery(value);
    if (cache.current) setHits(matchMemories(cache.current, value));
  }

  if (textCount === 0) return null;

  return (
    <section className="mt-8 rounded-2xl border border-line bg-paper-raised p-5">
      <h2 className="text-base text-ink">Find something you wrote</h2>

      {state === 'cold' && (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Searching happens on this device, so your vault has to be unlocked and read here
            first. Nothing about what you search for is ever sent anywhere.
          </p>
          <button
            type="button"
            onClick={prepare}
            className="mt-4 rounded-xl bg-ink px-5 py-3 text-sm text-paper"
          >
            Read my {textCount} written {textCount === 1 ? 'memory' : 'memories'} to search
          </button>
        </>
      )}

      {state === 'reading' && (
        <p className="mt-3 text-sm text-ink-soft" role="status">
          Decrypting on this device — {progress} of {thoughts.length}…
        </p>
      )}

      {state === 'failed' && (
        <p role="alert" className="mt-3 text-sm text-ember">
          Some of your vault could not be read just now. Nothing was changed — try again.
        </p>
      )}

      {state === 'ready' && cache.current && (
        <>
          <label htmlFor="vault-search" className="mt-3 block text-sm text-ink-soft">
            Search {searchableCount(cache.current)} written{' '}
            {searchableCount(cache.current) === 1 ? 'memory' : 'memories'}
            <input
              id="vault-search"
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="a word you remember using"
              autoComplete="off"
              className="mt-2 w-full min-w-0 rounded-xl border border-field bg-paper px-4 py-3 text-ink outline-none placeholder:text-ink-faint"
            />
          </label>

          {hits && query.trim() && (
            <p className="mt-3 text-sm text-ink-faint">
              {hits.length === 0
                ? 'Nothing matched.'
                : `${hits.length} ${hits.length === 1 ? 'memory' : 'memories'} matched.`}
            </p>
          )}

          {hits && hits.length > 0 && (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <Link href={`/vault/${hit.id}`} className="block py-4 hover:opacity-70">
                    <span className="text-xs text-ink-faint">
                      {new Date(hit.createdAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                    <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                      {hit.before}
                      <mark className="bg-transparent text-ink underline decoration-accent decoration-2 underline-offset-2">
                        {hit.match}
                      </mark>
                      {hit.after}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {thoughts.length !== searchableCount(cache.current) && (
            <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">
              Voice memories are not searchable. Transcribing them would mean producing text of
              what you said, and that is not something this product does quietly.
            </p>
          )}
        </>
      )}
    </section>
  );
}
