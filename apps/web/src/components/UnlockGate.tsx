'use client';

import { useState, type ReactNode } from 'react';
import { useVault } from '@/lib/vault';
import { RecoveryKit } from './RecoveryKit';

type Mode = 'create' | 'unlock' | 'recover';

const MIN_PASSPHRASE = 12;

/**
 * Stands between the user and anything encrypted.
 *
 * The passphrase is used to derive a key and then discarded — it is never
 * stored, never sent, and not held in state after the handler returns.
 */
export function UnlockGate({ children }: { children: ReactNode }) {
  const {
    isUnlocked,
    userId,
    pendingRecoveryCode,
    createNewVault,
    unlock,
    recover,
    acknowledgeRecoveryCode,
  } = useVault();

  const [mode, setMode] = useState<Mode>(userId ? 'unlock' : 'create');
  const [passphrase, setPassphrase] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [vaultId, setVaultId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A newly created vault shows its kit before anything else, including the
  // app itself. Losing this screen means losing the only way back in.
  if (pendingRecoveryCode && userId) {
    return (
      <RecoveryKit
        vaultId={userId}
        recoveryCode={pendingRecoveryCode}
        onAcknowledged={acknowledgeRecoveryCode}
      />
    );
  }

  if (isUnlocked) return <>{children}</>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        await createNewVault(passphrase);
      } else if (mode === 'unlock') {
        const id = userId ?? vaultId.trim();
        if (!id) throw new Error('missing vault id');
        await unlock(id, passphrase);
      } else {
        const id = (userId ?? vaultId).trim();
        if (!id) throw new Error('missing vault id');
        await recover(id, recoveryCode, passphrase);
      }
      setPassphrase('');
      setRecoveryCode('');
    } catch {
      setError(
        mode === 'create'
          ? 'That vault could not be created. Please try again.'
          : mode === 'unlock'
            ? 'That phrase did not unlock this vault.'
            : 'That recovery code did not match this vault. Check the vault ID and the code.',
      );
    } finally {
      setBusy(false);
    }
  }

  const copy = {
    create: {
      heading: 'Choose a phrase to lock your vault',
      body: 'This phrase never leaves your device — it is what encrypts everything you write here. We cannot see it or reset it. You will get a recovery kit next, in case you forget it.',
      action: 'Create my vault',
    },
    unlock: {
      heading: 'Unlock your vault',
      body: 'Your phrase unlocks the key held only on this device.',
      action: 'Unlock',
    },
    recover: {
      heading: 'Use your recovery kit',
      body: 'Enter the vault ID and recovery code from your kit, then choose a new phrase. Your memories are untouched — only the lock changes.',
      action: 'Recover my vault',
    },
  }[mode];

  const needsVaultId = mode === 'recover' || (mode === 'unlock' && !userId);

  return (
    <div className="flex flex-1 flex-col justify-center py-16">
      <h1 className="font-serif text-2xl text-ink">{copy.heading}</h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">{copy.body}</p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        {needsVaultId && (
          <input
            type="text"
            value={vaultId}
            onChange={(event) => setVaultId(event.target.value)}
            placeholder="Vault ID from your kit"
            autoComplete="off"
            spellCheck={false}
            required
            className="rounded-lg border border-line bg-paper-raised px-4 py-3 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-ember"
          />
        )}

        {mode === 'recover' && (
          <input
            type="text"
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
            placeholder="Recovery code"
            autoComplete="off"
            spellCheck={false}
            required
            className="rounded-lg border border-line bg-paper-raised px-4 py-3 font-mono text-sm uppercase text-ink outline-none placeholder:font-sans placeholder:normal-case placeholder:text-ink-faint focus:border-ember"
          />
        )}

        <input
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder={mode === 'recover' ? 'Choose a new phrase' : 'A phrase you will remember'}
          autoComplete={mode === 'unlock' ? 'current-password' : 'new-password'}
          minLength={MIN_PASSPHRASE}
          required
          className="rounded-lg border border-line bg-paper-raised px-4 py-3 text-ink outline-none placeholder:text-ink-faint focus:border-ember"
        />

        {error && <p className="text-sm text-ember">{error}</p>}

        <button
          type="submit"
          disabled={busy || passphrase.length < MIN_PASSPHRASE}
          className="rounded-lg bg-ink px-4 py-3 text-paper transition-opacity disabled:opacity-40"
        >
          {busy ? 'Deriving your key…' : copy.action}
        </button>
      </form>

      <div className="mt-6 flex flex-col gap-2 text-sm">
        {mode !== 'create' && (
          <button
            type="button"
            onClick={() => setMode('create')}
            className="self-start text-ink-faint underline underline-offset-4 hover:text-ink-soft"
          >
            Start a new vault instead
          </button>
        )}
        {mode !== 'unlock' && (
          <button
            type="button"
            onClick={() => setMode('unlock')}
            className="self-start text-ink-faint underline underline-offset-4 hover:text-ink-soft"
          >
            I have a vault and remember my phrase
          </button>
        )}
        {mode !== 'recover' && (
          <button
            type="button"
            onClick={() => setMode('recover')}
            className="self-start text-ink-faint underline underline-offset-4 hover:text-ink-soft"
          >
            I lost my phrase
          </button>
        )}
      </div>

      <p className="mt-8 max-w-prose text-xs leading-relaxed text-ink-faint">
        Deriving the key takes a moment on purpose — it is what makes a guessed phrase impractical
        to test at scale.
      </p>
    </div>
  );
}
