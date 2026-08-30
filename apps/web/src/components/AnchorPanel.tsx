'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { address } from '@solana/kit';
import { useSelectedWalletAccount, useSignAndSendTransaction } from '@solana/react';
import type { UiWalletAccount } from '@wallet-standard/react';
import { useVault } from '@/lib/vault';
import { useSolanaConfig, shortenAddress } from '@/lib/wallet';
import {
  buildAnchorTransaction,
  confirmAnchor,
  explorerUrl,
  getAnchorStatus,
  prepareAnchor,
  signatureToBase58,
  type AnchorStatus,
} from '@/lib/anchor';

/**
 * The proof panel on a single memory. Blueprint D-01 and D-02.
 *
 * It appears only once a wallet is connected, and it asks for a signature only
 * when the user chooses to anchor — never on load, and never as a precondition
 * for reading or writing anything (§14.5).
 */
export function AnchorPanel({ thoughtId }: { thoughtId: string }) {
  const { token } = useVault();
  const [account] = useSelectedWalletAccount();
  const [status, setStatus] = useState<AnchorStatus | null>(null);

  useEffect(() => {
    if (!token) return;
    getAnchorStatus(thoughtId, token)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [thoughtId, token]);

  if (status?.anchored && status.signature) {
    return <AnchoredProof status={status} />;
  }

  if (!account) {
    return (
      <p className="mt-6 text-xs leading-relaxed text-ink-faint">
        To anchor proof of this memory on Solana, connect a wallet in{' '}
        <Link href="/settings" className="underline underline-offset-4 hover:text-ink-soft">
          settings
        </Link>
        . It is entirely optional.
      </p>
    );
  }

  return <AnchorAction thoughtId={thoughtId} account={account} onAnchored={setStatus} />;
}

function AnchorAction({
  thoughtId,
  account,
  onAnchored,
}: {
  thoughtId: string;
  account: UiWalletAccount;
  onAnchored: (status: AnchorStatus) => void;
}) {
  const { token } = useVault();
  const { chain, rpc, network } = useSolanaConfig();
  const signAndSend = useSignAndSendTransaction(account, chain);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const anchor = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError(null);

    try {
      // 1. The server derives the commitment from the ciphertext hash it holds.
      const preparation = await prepareAnchor(thoughtId, account.address, token);

      // 2. We assemble the transaction locally.
      const transaction = await buildAnchorTransaction({
        preparation,
        owner: address(account.address),
        rpc,
      });

      // 3. The wallet signs and submits it. This is the only moment a signature
      //    is requested, and it follows a deliberate user action.
      setConfirming(true);
      const { signature } = await signAndSend({ transaction });
      const signatureBase58 = signatureToBase58(new Uint8Array(signature));

      // 4. Record the signature so the proof view can show it. The chain
      //    remains the source of truth.
      await confirmAnchor(thoughtId, signatureBase58, token);

      onAnchored({
        anchored: true,
        network: preparation.network,
        commitment: preparation.commitment,
        signature: signatureBase58,
        programId: preparation.programId,
      });
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(
        code === 'CONFLICT'
          ? 'This memory is already anchored.'
          : 'The anchor was not completed. Nothing was published, and your memory is untouched.',
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }, [thoughtId, account.address, token, rpc, signAndSend, onAnchored]);

  return (
    <div className="mt-6 rounded-xl border border-line bg-paper-raised p-5">
      <p className="text-sm leading-relaxed text-ink-soft">
        Anchor proof that this memory existed and is yours. Only a hash is published — not your
        words, not a title, not a date you wrote.
      </p>

      <button
        type="button"
        onClick={anchor}
        disabled={busy}
        className="mt-4 rounded-lg bg-ink px-5 py-2.5 text-sm text-paper disabled:opacity-40"
      >
        {confirming ? 'Approve in your wallet…' : busy ? 'Preparing…' : 'Anchor on Solana'}
      </button>

      {error && <p className="mt-4 text-sm text-ember">{error}</p>}

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        Signing with {shortenAddress(account.address)} on {network}. A small network fee applies.
        Anchoring cannot be undone — a public chain keeps its history.
      </p>
    </div>
  );
}

/** Blueprint D-02: show the proof, with nothing sensitive in it. */
function AnchoredProof({ status }: { status: AnchorStatus }) {
  const signature = status.signature as string;

  return (
    <div className="mt-6 rounded-xl border border-line bg-paper-raised p-5">
      <p className="text-xs uppercase tracking-wide text-ink-faint">Anchored</p>

      <dl className="mt-4 flex flex-col gap-3 text-xs">
        <div>
          <dt className="text-ink-faint">Network</dt>
          <dd className="mt-0.5 text-ink-soft">{status.network}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">Commitment</dt>
          <dd className="mt-0.5 break-all font-mono text-ink-soft">{status.commitment}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">Transaction</dt>
          <dd className="mt-0.5 break-all font-mono text-ink-soft">{signature}</dd>
        </div>
      </dl>

      <a
        href={explorerUrl(signature, status.network ?? 'devnet')}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 inline-block text-sm text-ink underline underline-offset-4"
      >
        View it on Solana Explorer
      </a>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        The commitment above is a one-way hash. It proves this memory existed without revealing
        anything about it — not even to us.
      </p>
    </div>
  );
}
