'use client';

import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { UnlockGate } from '@/components/UnlockGate';

/**
 * Home. Blueprint §11.1: the first action is "speak" or "write" — not
 * "create a journal entry". There is no feed, no streak, and no counter.
 */
export default function HomePage() {
  return (
    <Shell>
      <UnlockGate>
        <div className="flex flex-1 flex-col justify-center py-16">
          <h1 className="font-serif text-3xl leading-snug text-ink">What is on your mind?</h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            Nothing here is shared with anyone. You decide what happens to it after you finish.
          </p>

          <div className="mt-10 flex flex-col gap-3">
            <Link
              href="/capture?mode=voice"
              className="rounded-xl bg-ink px-6 py-5 text-center text-lg text-paper"
            >
              Talk
            </Link>
            <Link
              href="/capture?mode=text"
              className="rounded-xl border border-line bg-paper-raised px-6 py-5 text-center text-lg text-ink"
            >
              Write
            </Link>
            <Link
              href="/capture?mode=text&guided=1"
              className="px-6 py-3 text-center text-sm text-ink-faint hover:text-ink-soft"
            >
              I do not know
            </Link>
          </div>
        </div>
      </UnlockGate>
    </Shell>
  );
}
