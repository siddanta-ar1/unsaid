'use client';

import { useCallback, useState } from 'react';
import { formatRecoveryKit } from '@unsaid/crypto';

/**
 * Shown once, immediately after a vault is created.
 *
 * This screen is the difference between "I forgot my phrase" being an
 * inconvenience and being the permanent loss of everything a person wrote. It
 * blocks: there is no dismiss control until they have copied or downloaded the
 * kit and ticked the confirmation, because the moment this closes we can never
 * show it again.
 */
export function RecoveryKit({
  vaultId,
  recoveryCode,
  onAcknowledged,
}: {
  vaultId: string;
  recoveryCode: string;
  onAcknowledged: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const kit = formatRecoveryKit(vaultId, recoveryCode);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(kit);
      setCopyState('copied');
      setSaved(true);
    } catch {
      setCopyState('failed');
    }
  }, [kit]);

  const download = useCallback(() => {
    const blob = new Blob([kit], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'unsaid-recovery-kit.txt';
    link.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }, [kit]);

  return (
    <div className="flex flex-1 flex-col justify-center py-12">
      <h1 className="font-serif text-2xl text-ink">Save this before you go any further</h1>

      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        This is the only way back into your vault if you forget your phrase. We do not have a copy.
        We cannot email it to you, reset it, or recover your memories without it.
      </p>

      <pre className="mt-6 overflow-x-auto rounded-xl border border-line bg-paper-raised p-5 font-mono text-xs leading-relaxed text-ink">
        {kit}
      </pre>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={download}
          className="rounded-lg bg-ink px-5 py-2.5 text-sm text-paper"
        >
          Download it
        </button>
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-line px-5 py-2.5 text-sm text-ink"
        >
          {copyState === 'copied' ? 'Copied' : 'Copy it'}
        </button>
      </div>

      {copyState === 'failed' && (
        <p className="mt-3 text-sm text-ember">
          Your browser blocked the clipboard. Download it instead, or select the text above and copy
          it by hand.
        </p>
      )}

      <label className="mt-8 flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-ink-soft">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1 size-4 accent-ink"
        />
        <span>
          I have saved this somewhere safe and offline. I understand that if I lose both my phrase
          and this kit, everything in my vault stays locked forever.
        </span>
      </label>

      <button
        type="button"
        onClick={onAcknowledged}
        disabled={!confirmed || !saved}
        className="mt-6 self-start rounded-lg bg-ink px-6 py-3 text-paper transition-opacity disabled:opacity-30"
      >
        Continue
      </button>

      {!saved && (
        <p className="mt-3 text-xs text-ink-faint">
          Download or copy the kit first — this screen cannot be shown again.
        </p>
      )}
    </div>
  );
}
