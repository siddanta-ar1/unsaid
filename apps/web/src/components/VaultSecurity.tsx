'use client';

import { useCallback, useState } from 'react';
import { formatRecoveryKit } from '@unsaid/crypto';
import { useVault } from '@/lib/vault';

const MIN_PASSPHRASE = 12;

/**
 * Changing a passphrase and reissuing a recovery kit.
 *
 * Both re-wrap the vault key and nothing else — no memory is re-encrypted, and
 * no ciphertext is re-uploaded. A pilot user who typed their phrase somewhere
 * visible needs a way out that is not "start again and lose everything".
 */
export function VaultSecurity() {
  const { userId, setPassphrase, reissueRecoveryKit } = useVault();

  const [phrase, setPhrase] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [phraseState, setPhraseState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [phraseError, setPhraseError] = useState<string | null>(null);

  const [newKit, setNewKit] = useState<string | null>(null);
  const [kitBusy, setKitBusy] = useState(false);
  const [kitError, setKitError] = useState<string | null>(null);

  const mismatch = confirmPhrase.length > 0 && phrase !== confirmPhrase;

  const changePhrase = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (phrase !== confirmPhrase) return;
      setPhraseState('busy');
      setPhraseError(null);
      try {
        await setPassphrase(phrase);
        setPhrase('');
        setConfirmPhrase('');
        setPhraseState('done');
      } catch {
        setPhraseError('That change did not go through. Your old phrase still works.');
        setPhraseState('idle');
      }
    },
    [phrase, confirmPhrase, setPassphrase],
  );

  const reissue = useCallback(async () => {
    setKitBusy(true);
    setKitError(null);
    try {
      setNewKit(await reissueRecoveryKit());
    } catch {
      setKitError('The kit could not be replaced. Your existing kit still works.');
    } finally {
      setKitBusy(false);
    }
  }, [reissueRecoveryKit]);

  const downloadKit = useCallback(() => {
    if (!newKit || !userId) return;
    const blob = new Blob([formatRecoveryKit(userId, newKit)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'unsaid-recovery-kit.txt';
    link.click();
    URL.revokeObjectURL(url);
  }, [newKit, userId]);

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={changePhrase}
        className="flex flex-col gap-3 rounded-xl border border-line bg-paper-raised p-6"
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          Changing your phrase re-locks your vault and signs out every other device. Your
          memories are not re-encrypted or re-uploaded, and your recovery kit keeps working.
        </p>

        <input
          type="password"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          placeholder="New phrase"
          autoComplete="new-password"
          minLength={MIN_PASSPHRASE}
          className="rounded-lg border border-field bg-paper px-4 py-3 text-ink outline-none placeholder:text-ink-faint focus:border-ember"
        />
        <input
          type="password"
          value={confirmPhrase}
          onChange={(event) => setConfirmPhrase(event.target.value)}
          placeholder="Type it again"
          autoComplete="new-password"
          aria-invalid={mismatch ? true : undefined}
          aria-describedby={mismatch ? 'phrase-mismatch' : undefined}
          className="rounded-lg border border-field bg-paper px-4 py-3 text-ink outline-none placeholder:text-ink-faint focus:border-ember"
        />

        {mismatch && (
          <p id="phrase-mismatch" role="alert" className="text-sm text-ember">
            Those two do not match.
          </p>
        )}
        <p role="alert" className="text-sm text-ember empty:hidden">{phraseError}</p>
        {phraseState === 'done' && (
          <p className="text-sm text-ink-soft" aria-live="polite">
            Changed. Your old phrase no longer opens this vault, and anywhere else you were
            signed in has been signed out.
          </p>
        )}

        <button
          type="submit"
          disabled={phraseState === 'busy' || phrase.length < MIN_PASSPHRASE || mismatch}
          className="self-start rounded-lg border border-transparent bg-ink px-5 py-2.5 text-sm text-paper disabled:cursor-not-allowed disabled:border-field disabled:bg-transparent disabled:text-ink-faint"
        >
          {phraseState === 'busy' ? 'Re-locking…' : 'Change my phrase'}
        </button>
      </form>

      <div className="rounded-xl border border-line bg-paper-raised p-6">
        {newKit && userId ? (
          <>
            <p className="text-sm leading-relaxed text-ink">
              This is your new kit. The old one stopped working the moment this appeared.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-paper p-4 font-mono text-xs leading-relaxed text-ink">
              {formatRecoveryKit(userId, newKit)}
            </pre>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={downloadKit}
                className="rounded-lg bg-ink px-5 py-2.5 text-sm text-paper"
              >
                Download it
              </button>
              <button
                type="button"
                onClick={() => setNewKit(null)}
                className="px-5 py-2.5 text-sm text-ink-soft"
              >
                I have saved it
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-ink-soft">
              Replace your recovery kit if you think someone else has seen it. The old code stops
              working immediately, and every other device is signed out.
            </p>
            <p role="alert" className="mt-3 text-sm text-ember empty:hidden">{kitError}</p>
            <button
              type="button"
              onClick={reissue}
              disabled={kitBusy}
              className="mt-5 rounded-lg border border-field px-5 py-2.5 text-sm text-ink disabled:cursor-not-allowed disabled:text-ink-faint"
            >
              {kitBusy ? 'Issuing…' : 'Issue a new recovery kit'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
