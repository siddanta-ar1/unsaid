import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Verifier } from './Verifier';

/**
 * The public verifier.
 *
 * Every other screen in this product asks you to believe us. This one does not:
 * it derives the record address from what you paste, reads it from a public
 * Solana RPC, and reports what the chain says. Our API is not in the path. If
 * our API were lying, this page would still tell the truth — which is the only
 * reason the consent record is worth writing to a chain at all.
 */
export const metadata: Metadata = {
  title: 'Verify a proof — UNSAID',
  description:
    'Check that an encrypted memory existed at a point in time, and who owned it, without seeing a word of it.',
  robots: { index: true, follow: true },
};

export default function VerifyPage() {
  return (
    <Suspense fallback={<VerifierFallback />}>
      <Verifier />
    </Suspense>
  );
}

/** Matches the resting shape of the form so nothing jumps when it mounts. */
function VerifierFallback() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <p className="text-sm text-ink-faint">Loading the verifier…</p>
    </div>
  );
}
