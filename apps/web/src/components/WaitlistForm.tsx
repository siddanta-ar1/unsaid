'use client';

import { useState } from 'react';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3011';

/**
 * Waitlist capture.
 *
 * The only place in the product that asks for an email, and it is deliberately
 * unconnected to any vault: joining this list says nothing about whether you
 * use UNSAID, and using UNSAID does not put you on it.
 */
export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'joined' | 'error'>('idle');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState('sending');
    try {
      const response = await fetch(`${BASE_URL}/v1/signals/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'landing' }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setState('joined');
      setEmail('');
    } catch {
      setState('error');
    }
  }

  if (state === 'joined') {
    return (
      <p className="text-sm leading-relaxed text-ink-soft" aria-live="polite">
        You are on the list. We will write once, when there is something to try — and this
        address is not connected to any vault you create.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3 sm:flex-row">
      <label className="sr-only" htmlFor="waitlist-email">
        Email address
      </label>
      <input
        id="waitlist-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        required
        className="flex-1 rounded-lg border border-line bg-paper-raised px-4 py-3 text-ink outline-none placeholder:text-ink-faint focus:border-ember"
      />
      <button
        type="submit"
        disabled={state === 'sending'}
        className="rounded-lg bg-ink px-5 py-3 text-paper disabled:opacity-40"
      >
        {state === 'sending' ? 'Adding…' : 'Keep me posted'}
      </button>
      {state === 'error' && (
        <p className="text-sm text-ember sm:w-full">That did not go through. Please try again.</p>
      )}
    </form>
  );
}
