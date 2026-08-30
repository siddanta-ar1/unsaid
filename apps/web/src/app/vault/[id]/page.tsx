'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { decodeUtf8 } from '@unsaid/crypto';
import { Shell } from '@/components/Shell';
import { UnlockGate } from '@/components/UnlockGate';
import { useVault } from '@/lib/vault';
import { deleteThought, grantReflectionConsent, openThought, reflect } from '@/lib/thoughts';
import { ReflectConsentSheet } from '@/components/ReflectConsentSheet';
import { AnchorPanel } from '@/components/AnchorPanel';

export default function ThoughtPage() {
  return (
    <Shell>
      <UnlockGate>
        <ThoughtDetail />
      </UnlockGate>
    </Shell>
  );
}

type DeleteChoice = 'cloud_delete' | 'forget';

function ThoughtDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, key } = useVault();

  const [text, setText] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showConsent, setShowConsent] = useState(false);
  const [echo, setEcho] = useState<{ content: string; safety: string } | null>(null);
  const [echoBusy, setEchoBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DeleteChoice | null>(null);

  useEffect(() => {
    if (!token || !key || !id) return;
    let objectUrl: string | null = null;

    openThought(id, token, key)
      .then(({ metadata, bytes }) => {
        setCreatedAt(metadata.createdAt);
        if (metadata.type === 'audio') {
          // Decrypted bytes stay in a blob URL scoped to this page, revoked on
          // unmount so they are not left addressable in the tab.
          objectUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]));
          setAudioUrl(objectUrl);
        } else {
          setText(decodeUtf8(bytes));
        }
      })
      .catch((cause: unknown) => {
        const code = (cause as { code?: string }).code;
        setError(
          code === 'CRYPTO_VERSION_UNSUPPORTED'
            ? 'You chose to forget this memory. The key is gone, so it can no longer be opened — by us or by anyone.'
            : 'This memory could not be opened on this device.',
        );
      });

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, token, key]);

  const runReflection = useCallback(async () => {
    if (!token || !text) return;
    setShowConsent(false);
    setEchoBusy(true);
    try {
      await grantReflectionConsent(token);
      const result = await reflect(id, text, token);
      setEcho({ content: result.content, safety: result.safetyNotice });
    } catch {
      setError('Echo could not respond right now. Your thought is untouched.');
    } finally {
      setEchoBusy(false);
    }
  }, [id, text, token]);

  const remove = useCallback(
    async (mode: DeleteChoice) => {
      if (!token) return;
      await deleteThought(id, mode, token);
      router.push('/vault');
    },
    [id, token, router],
  );

  if (error) {
    return (
      <div className="py-16">
        <p className="text-sm leading-relaxed text-ink-soft">{error}</p>
        <button
          type="button"
          onClick={() => router.push('/vault')}
          className="mt-8 text-sm text-ink-faint underline underline-offset-4"
        >
          Back to your vault
        </button>
      </div>
    );
  }

  if (!text && !audioUrl) {
    return <p className="py-16 text-sm text-ink-faint">Decrypting on this device…</p>;
  }

  return (
    <div className="py-8">
      {createdAt && (
        <p className="text-xs text-ink-faint">
          {new Date(createdAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}
        </p>
      )}

      {text && (
        <p className="mt-6 whitespace-pre-wrap font-serif text-lg leading-relaxed text-ink">
          {text}
        </p>
      )}
      {audioUrl && <audio controls src={audioUrl} className="mt-6 w-full" />}

      {echo && (
        <div className="mt-10 rounded-xl border border-line bg-paper-raised p-6">
          <p className="text-xs uppercase tracking-wide text-ink-faint">Echo</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
            {echo.content}
          </p>
          {echo.safety === 'support_resources' && (
            <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ember">
              If you are in danger right now, please contact someone you trust or a local
              emergency or crisis line. UNSAID is not a crisis service.
            </p>
          )}
        </div>
      )}

      <AnchorPanel thoughtId={id} />

      <div className="mt-12 flex flex-col gap-3 border-t border-line pt-8">
        {text && !echo && (
          <button
            type="button"
            onClick={() => setShowConsent(true)}
            disabled={echoBusy}
            className="self-start text-sm text-ink underline underline-offset-4 disabled:opacity-40"
          >
            {echoBusy ? 'Echo is reading…' : 'Ask Echo to reflect on this'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirmDelete('cloud_delete')}
          className="self-start text-sm text-ink-soft underline underline-offset-4"
        >
          Delete this memory
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete('forget')}
          className="self-start text-sm text-ink-soft underline underline-offset-4"
        >
          Forget this memory
        </button>
      </div>

      {confirmDelete && (
        <div className="mt-8 rounded-xl border border-line bg-paper-raised p-6">
          <p className="text-sm leading-relaxed text-ink">
            {confirmDelete === 'forget'
              ? 'Forgetting destroys the key that opens this memory. Even if a copy of the encrypted file survives somewhere, nothing can read it again — including us. This cannot be undone.'
              : 'This removes the encrypted file and its record. This cannot be undone.'}
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => remove(confirmDelete)}
              className="rounded-lg bg-ink px-5 py-2.5 text-sm text-paper"
            >
              {confirmDelete === 'forget' ? 'Forget it' : 'Delete it'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="px-5 py-2.5 text-sm text-ink-soft"
            >
              Keep it
            </button>
          </div>
        </div>
      )}

      {showConsent && (
        <ReflectConsentSheet onConfirm={runReflection} onCancel={() => setShowConsent(false)} />
      )}
    </div>
  );
}
