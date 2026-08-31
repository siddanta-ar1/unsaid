'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ThoughtMetadata } from '@unsaid/types';
import { Shell } from '@/components/Shell';
import { UnlockGate } from '@/components/UnlockGate';
import { useVault } from '@/lib/vault';
import { listThoughts } from '@/lib/thoughts';

/**
 * The vault timeline. Blueprint §11.4.
 *
 * Note what a row can show: a date, a kind, and a size. Titles and previews
 * would require the server to hold something readable, so there are none — the
 * absence of a preview is the privacy model made visible.
 */
export default function VaultPage() {
  return (
    <Shell screen="vault">
      <UnlockGate>
        <VaultList />
      </UnlockGate>
    </Shell>
  );
}

function VaultList() {
  const { token } = useVault();
  const [thoughts, setThoughts] = useState<ThoughtMetadata[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    listThoughts(token)
      .then(setThoughts)
      .catch(() => setError('Your vault could not be loaded right now.'));
  }, [token]);

  if (error) return <p className="py-16 text-sm text-ember">{error}</p>;
  if (!thoughts) return <p className="py-16 text-sm text-ink-faint">Opening your vault…</p>;

  if (thoughts.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-serif text-2xl text-ink">Nothing here yet.</h1>
        <p className="mt-3 text-sm text-ink-soft">
          Whatever you keep will appear here, readable only on a device holding your phrase.
        </p>
        <Link href="/app" className="mt-8 self-start rounded-xl bg-ink px-6 py-3 text-paper">
          Say something
        </Link>
      </div>
    );
  }

  return (
    <div className="py-8">
      <h1 className="font-serif text-2xl text-ink">Your vault</h1>
      <p className="mt-2 text-sm text-ink-soft">
        {thoughts.length} {thoughts.length === 1 ? 'memory' : 'memories'}, encrypted.
      </p>

      <ul className="mt-8 divide-y divide-line border-t border-line">
        {thoughts.map((thought) => (
          <li key={thought.id}>
            <Link
              href={`/vault/${thought.id}`}
              className="flex items-baseline justify-between py-5 hover:opacity-70"
            >
              <span className="text-ink">
                {new Date(thought.createdAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
              <span className="text-xs text-ink-faint">
                {thought.type === 'audio' ? 'Voice' : 'Written'} ·{' '}
                {new Date(thought.createdAt).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
