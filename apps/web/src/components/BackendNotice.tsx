'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3011';

/**
 * Says so when the vault's backend cannot be reached.
 *
 * The hosted demo serves the parts that need nothing from us — the landing
 * page and the verifier, which reads Solana directly — while the vault itself
 * needs an API, a database and object storage that may not be running.
 *
 * Without this, that situation reaches the user as "that vault could not be
 * created, please try again": a lie by omission on the one screen where the
 * product is asking to be trusted with something. Naming the real reason costs
 * one probe of /health and keeps the honesty the rest of the product claims.
 */
export function BackendNotice() {
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    fetch(`${BASE_URL}/health`, { signal: controller.signal })
      .then((response) => setReachable(response.ok))
      .catch(() => setReachable(false))
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  // Unknown is not reported. A slow network briefly claiming the backend is
  // down would be its own small dishonesty.
  if (reachable !== false) return null;

  return (
    <div role="status" className="mt-6 rounded-lg border border-field bg-paper-raised p-4">
      <p className="text-sm text-ink">The vault&rsquo;s backend is not reachable from here.</p>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
        Nothing you do on this page will be saved. The parts that depend on nobody —{' '}
        <Link href="/verify" className="underline underline-offset-4 hover:text-ink">
          verifying a proof against Solana
        </Link>{' '}
        — still work, because they read the chain directly rather than asking us anything. To use
        the vault itself, run the stack locally: the README has the four commands.
      </p>
    </div>
  );
}
