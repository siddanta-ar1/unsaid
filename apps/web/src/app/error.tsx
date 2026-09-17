'use client';

import { useEffect } from 'react';

/**
 * The render-time failure screen.
 *
 * It says what did not happen, because on this product the first fear is not
 * "the page broke" but "did my memories leak". It also never prints the error:
 * a stack trace here could carry a fragment of something decrypted in this tab.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Deliberately not logged. Client errors on this screen can hold plaintext.
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-6 py-16">
      <h1 className="font-serif text-2xl text-ink">That screen did not load.</h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        Nothing was sent anywhere and nothing was changed. Your vault is as you left it. Reloading
        locks it, so you will be asked for your phrase again.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-transparent bg-ink px-6 py-3 text-paper"
        >
          Try again
        </button>
        <a
          href="/vault"
          className="rounded-lg border border-field px-6 py-3 text-sm text-ink-soft hover:text-ink"
        >
          Back to the vault
        </a>
      </div>
    </div>
  );
}
