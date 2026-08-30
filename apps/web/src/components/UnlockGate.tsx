'use client';

import { useState, type ReactNode } from 'react';
import { useVault } from '@/lib/vault';

/**
 * Stands between the user and anything encrypted. The passphrase is used to
 * derive a key and is then discarded — it is never stored, never sent, and
 * never held in state after this component's handler returns.
 */
export function UnlockGate({ children }: { children: ReactNode }) {
  const { isUnlocked, userId, createVault, unlock } = useVault();
  const [passphrase, setPassphrase] = useState('');
  const [mode, setMode] = useState<'create' | 'unlock'>(userId ? 'unlock' : 'create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isUnlocked) return <>{children}</>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') await createVault(passphrase);
      else if (userId) await unlock(userId, passphrase);
      setPassphrase('');
    } catch {
      setError(
        mode === 'create'
          ? 'That vault could not be created. Please try again.'
          : 'That passphrase did not unlock this vault.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col justify-center py-16">
      <h1 className="font-serif text-2xl text-ink">
        {mode === 'create' ? 'Choose a phrase to lock your vault' : 'Unlock your vault'}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        {mode === 'create'
          ? 'This phrase never leaves your device. It is what encrypts everything you write here. We cannot see it, reset it, or recover it for you — if you lose it, what is inside stays locked forever.'
          : 'Your phrase unlocks the key held only on this device.'}
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <input
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder="A phrase you will remember"
          autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
          minLength={12}
          required
          className="rounded-lg border border-line bg-paper-raised px-4 py-3 text-ink outline-none placeholder:text-ink-faint focus:border-ember"
        />
        {error && <p className="text-sm text-ember">{error}</p>}
        <button
          type="submit"
          disabled={busy || passphrase.length < 12}
          className="rounded-lg bg-ink px-4 py-3 text-paper transition-opacity disabled:opacity-40"
        >
          {busy ? 'Deriving your key…' : mode === 'create' ? 'Create my vault' : 'Unlock'}
        </button>
      </form>

      {userId && (
        <button
          type="button"
          onClick={() => setMode(mode === 'create' ? 'unlock' : 'create')}
          className="mt-6 self-start text-sm text-ink-faint underline underline-offset-4 hover:text-ink-soft"
        >
          {mode === 'create' ? 'I already have a vault' : 'Start a new vault instead'}
        </button>
      )}

      <p className="mt-8 text-xs leading-relaxed text-ink-faint">
        Deriving the key takes a moment on purpose — it is what makes a guessed phrase
        impractical to test at scale.
      </p>
    </div>
  );
}
