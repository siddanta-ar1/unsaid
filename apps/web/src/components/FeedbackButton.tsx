'use client';

import { useState } from 'react';
import { useVault } from '@/lib/vault';
import { sendFeedback, type FeedbackScreen } from '@/lib/signals';

/**
 * One-tap feedback, available on every screen.
 *
 * Most pilot users will never write an email. They will hit something
 * confusing, abandon quietly, and we will never learn which screen did it.
 * This exists to catch that moment while they are still standing in it.
 *
 * The message field is the single place in the entire product where a user may
 * deliberately write something we can read — so the panel says exactly that,
 * before they type, rather than after.
 */

const SENTIMENTS = [
  { id: 'confused', label: 'This confused me' },
  { id: 'broken', label: 'Something broke' },
  { id: 'idea', label: 'I have an idea' },
  { id: 'other', label: 'Something else' },
] as const;

export function FeedbackButton({ screen }: { screen: FeedbackScreen }) {
  const { token } = useVault();
  const [open, setOpen] = useState(false);
  const [sentiment, setSentiment] = useState<(typeof SENTIMENTS)[number]['id'] | null>(null);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!sentiment) return;
    setState('sending');
    try {
      await sendFeedback({
        screen,
        sentiment,
        ...(message.trim() ? { message: message.trim() } : {}),
        token,
      });
      setState('sent');
      setMessage('');
      setSentiment(null);
    } catch {
      setState('error');
    }
  }

  function close() {
    setOpen(false);
    setState('idle');
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 rounded-full border border-field bg-paper-raised px-4 py-2 text-xs text-ink-soft shadow-sm hover:text-ink"
      >
        Something felt off
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-line bg-paper-raised p-6">
        {state === 'sent' ? (
          <>
            <h2 className="font-serif text-xl text-ink">Thank you — that helps.</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              We know which screen you were on and nothing about what you wrote there.
            </p>
            <button
              type="button"
              onClick={close}
              className="mt-6 rounded-lg bg-ink px-5 py-2.5 text-sm text-paper"
            >
              Close
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2 className="font-serif text-xl text-ink">What felt off?</h2>

            <div className="mt-5 flex flex-col gap-2">
              {SENTIMENTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSentiment(option.id)}
                  className={`rounded-lg border px-4 py-2.5 text-left text-sm ${
                    sentiment === option.id
                      ? 'border-ember text-ink'
                      : 'border-line text-ink-soft hover:text-ink'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className="mt-5 block text-sm text-ink-soft">
              Anything else? <span className="text-ink-faint">(optional)</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={3}
                maxLength={1000}
                className="mt-2 w-full resize-none rounded-lg border border-field bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ember"
              />
            </label>

            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              Unlike everything else here, <span className="text-ink-soft">a person reads this
              box</span>. Please do not paste anything private into it.
            </p>

            {state === 'error' && (
              <p role="alert" className="mt-3 text-sm text-ember">That did not send. Please try again.</p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="submit"
                disabled={!sentiment || state === 'sending'}
                className="rounded-lg border border-transparent bg-ink px-5 py-2.5 text-sm text-paper disabled:cursor-not-allowed disabled:border-field disabled:bg-transparent disabled:text-ink-faint"
              >
                {state === 'sending' ? 'Sending…' : 'Send'}
              </button>
              <button type="button" onClick={close} className="px-5 py-2.5 text-sm text-ink-soft">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
