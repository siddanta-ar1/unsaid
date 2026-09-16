'use client';

import { useCallback, useState } from 'react';
import { useVault } from '@/lib/vault';
import { exportVault, type ExportProgress } from '@/lib/export';

/**
 * Leaving with everything.
 *
 * The whole encryption model asks people to trust a system they cannot inspect.
 * The credible answer to "what if I want out?" is not a promise — it is a
 * button that hands them every word, readable without us.
 */
export function VaultExport() {
  const { token, key } = useVault();
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const run = useCallback(async () => {
    if (!token || !key) return;
    setError(null);
    setDone(false);
    setProgress({ completed: 0, total: 0, failed: 0 });

    try {
      const archive = await exportVault({ token, key, onProgress: setProgress });

      const url = URL.createObjectURL(archive);
      const link = document.createElement('a');
      link.href = url;
      link.download = `unsaid-export-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch {
      setError('The export could not be completed. Nothing in your vault has changed.');
    } finally {
      setProgress(null);
    }
  }, [token, key]);

  const busy = progress !== null;

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-6">
      <p className="text-sm leading-relaxed text-ink-soft">
        Download every memory, decrypted, as a folder of ordinary text and audio files. It opens
        without UNSAID — on any computer, years from now, whether or not we still exist.
      </p>

      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="mt-5 rounded-lg border border-transparent bg-ink px-5 py-2.5 text-sm text-paper disabled:cursor-not-allowed disabled:border-field disabled:bg-transparent disabled:text-ink-faint"
      >
        {busy ? 'Decrypting…' : 'Export everything'}
      </button>

      {progress && progress.total > 0 && (
        <p className="mt-4 text-sm text-ink-soft" aria-live="polite">
          Decrypting {progress.completed} of {progress.total} on this device…
        </p>
      )}

      {done && (
        <p className="mt-4 text-sm text-ink-soft" aria-live="polite">
          Downloaded. That archive is <span className="text-ink">not encrypted</span> — anyone who
          opens it can read everything. Store it the way you would store a paper diary.
        </p>
      )}

      <p role="alert" className="mt-4 text-sm text-ember empty:hidden">{error}</p>
    </div>
  );
}
