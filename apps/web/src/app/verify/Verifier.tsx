'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { address, createSolanaRpc, type Address } from '@solana/kit';
import { computeCommitment, deriveThoughtSeed, fromBase64Url } from '@unsaid/crypto';
import { UNSAID_PROGRAM_ID, deriveRecordAddress, decodeThoughtRecord } from '@unsaid/solana';
import { Logo } from '@/components/Logo';

const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet';
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  (NETWORK === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
const PROGRAM_ID = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID ?? UNSAID_PROGRAM_ID;

type Result =
  | { kind: 'none' }
  | { kind: 'missing'; recordAddress: string }
  | {
      kind: 'found';
      recordAddress: string;
      owner: string;
      commitment: string;
      status: number;
      createdAt: Date;
      /** null when no ciphertext hash was supplied — existence only, no content claim. */
      commitmentMatches: boolean | null;
    };

const RECORD_STATUS: Record<number, string> = { 0: 'Active', 1: 'Revoked' };

export function Verifier() {
  const params = useSearchParams();
  const [owner, setOwner] = useState('');
  const [thoughtId, setThoughtId] = useState('');
  const [contentHash, setContentHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>({ kind: 'none' });
  const [ranFromLink, setRanFromLink] = useState(false);

  const check = useCallback(
    async (ownerValue: string, idValue: string, hashValue: string) => {
      setBusy(true);
      setError(null);
      setResult({ kind: 'none' });

      try {
        let ownerAddress: Address;
        try {
          ownerAddress = address(ownerValue.trim());
        } catch {
          throw new Error('That does not look like a Solana address.');
        }

        const seed = fromBase64Url(await deriveThoughtSeed(idValue.trim()));
        const [recordAddress] = await deriveRecordAddress(
          ownerAddress,
          seed,
          address(PROGRAM_ID),
        );

        const rpc = createSolanaRpc(RPC_URL);
        const { value } = await rpc
          .getAccountInfo(recordAddress, { encoding: 'base64' })
          .send();

        if (!value) {
          setResult({ kind: 'missing', recordAddress });
          return;
        }

        const [base64] = value.data;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const record = decodeThoughtRecord(bytes);

        // Without a ciphertext hash this proves a record exists and who owns
        // it. With one, it proves *this* encrypted memory is the one recorded.
        let commitmentMatches: boolean | null = null;
        const hash = hashValue.trim();
        if (hash) {
          const expected = await computeCommitment(hash, idValue.trim());
          commitmentMatches = areEqual(fromBase64Url(expected), record.commitment);
        }

        setResult({
          kind: 'found',
          recordAddress,
          owner: record.owner,
          commitment: toHex(record.commitment),
          status: record.status,
          createdAt: new Date(Number(record.createdAt) * 1000),
          commitmentMatches,
        });
      } catch (cause) {
        setError(
          cause instanceof Error && cause.message.startsWith('That does not look')
            ? cause.message
            : 'The chain could not be reached, or that record could not be read.',
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // A verification is meant to be sent to someone, so it has to survive being a
  // link. Prefill from the query, and when the link carries enough to check,
  // check it — a recipient who has to press a button first is being asked to
  // participate in a proof rather than shown one.
  useEffect(() => {
    const o = params.get('owner') ?? '';
    const i = params.get('id') ?? '';
    const h = params.get('hash') ?? '';
    if (o) setOwner(o);
    if (i) setThoughtId(i);
    if (h) setContentHash(h);
    if (o && i && !ranFromLink) {
      setRanFromLink(true);
      void check(o, i, h);
    }
  }, [params, ranFromLink, check]);

  const ready = owner.trim().length > 0 && thoughtId.trim().length > 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6">
      <header className="flex items-baseline justify-between py-8">
        <Link href="/" className="text-ink" aria-label="UNSAID — home">
          <Logo withWordmark />
        </Link>
        <nav className="flex gap-6 text-sm text-ink-soft">
          <Link href="/privacy" className="hover:text-ink">
            How it works
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col py-6">
        <h1 className="font-serif text-3xl leading-tight text-ink">Verify a proof</h1>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-soft">
          Check that an encrypted memory existed at a point in time, and who owned it — without
          seeing a word of it. This page reads Solana directly. Our servers are not involved, so
          nothing we could say changes what you see here.
        </p>

        <form
          className="mt-10 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void check(owner, thoughtId, contentHash);
          }}
        >
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wide text-ink-faint">Owner address</span>
            <input
              id="verify-owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="The wallet that anchored it"
              autoComplete="off"
              spellCheck={false}
              className="rounded-lg border border-field bg-paper-raised px-4 py-3 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-ember"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wide text-ink-faint">Memory ID</span>
            <input
              id="verify-id"
              value={thoughtId}
              onChange={(event) => setThoughtId(event.target.value)}
              placeholder="The id from the proof panel"
              autoComplete="off"
              spellCheck={false}
              className="rounded-lg border border-field bg-paper-raised px-4 py-3 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-ember"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wide text-ink-faint">
              Ciphertext hash — optional
            </span>
            <input
              id="verify-hash"
              value={contentHash}
              onChange={(event) => setContentHash(event.target.value)}
              placeholder="Proves this exact encrypted memory, not just that one existed"
              autoComplete="off"
              spellCheck={false}
              className="rounded-lg border border-field bg-paper-raised px-4 py-3 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-ember"
            />
          </label>

          <button
            type="submit"
            disabled={!ready || busy}
            className="mt-2 self-start rounded-lg border border-transparent bg-ink px-6 py-3 text-paper transition-colors disabled:cursor-not-allowed disabled:border-field disabled:bg-transparent disabled:text-ink-faint"
          >
            {busy ? 'Reading the chain…' : 'Check the chain'}
          </button>
        </form>

        {error && (
          <p role="alert" className="mt-6 text-sm text-ember">
            {error}
          </p>
        )}

        {result.kind === 'missing' && (
          <section className="mt-10 border-t border-line pt-6">
            <h2 className="font-serif text-xl text-ink">No record at that address</h2>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
              Nothing has been anchored for that owner and memory. Either it was never anchored,
              the details do not match, or it was anchored on a different network.
            </p>
            <dl className="mt-6">
              <Field label="Address checked" value={result.recordAddress} />
            </dl>
          </section>
        )}

        {result.kind === 'found' && (
          <section className="mt-10 border-t border-line pt-6">
            <h2 className="font-serif text-xl text-ink">
              {result.commitmentMatches === false
                ? 'A record exists, but it is not this memory'
                : 'This memory was anchored'}
            </h2>

            <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
              {result.commitmentMatches === true &&
                'The commitment on chain matches the ciphertext hash you supplied. This exact encrypted memory existed at the time below, owned by that key.'}
              {result.commitmentMatches === null &&
                'A record exists for that owner and memory. Supply the ciphertext hash to prove it is this exact encrypted memory rather than only that one was anchored.'}
              {result.commitmentMatches === false &&
                'The commitment on chain does not match the hash you supplied. The record is real, but it commits to different bytes.'}
            </p>

            <dl className="mt-6 flex flex-col gap-3">
              <Field label="Owner" value={result.owner} />
              <Field label="Anchored" value={result.createdAt.toLocaleString()} />
              <Field label="Status" value={RECORD_STATUS[result.status] ?? `Unknown (${result.status})`} />
              <Field label="Commitment" value={result.commitment} />
              <Field label="Record address" value={result.recordAddress} />
            </dl>

            <a
              href={`https://explorer.solana.com/address/${result.recordAddress}${
                NETWORK === 'mainnet-beta' ? '' : `?cluster=${NETWORK}`
              }`}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-6 inline-block text-sm text-ink-faint underline underline-offset-4 hover:text-ink-soft"
            >
              See it on the explorer
            </a>
          </section>
        )}

        <section className="mt-16 border-t border-line pt-6">
          <h2 className="text-base text-ink">What this does not prove</h2>
          <ul className="mt-3 flex max-w-prose list-none flex-col gap-2 p-0 text-sm leading-relaxed text-ink-soft">
            <li>Nothing about what the memory says. The commitment is a one-way hash.</li>
            <li>Nothing about who owns the wallet. It proves a key anchored it, not a person.</li>
            <li>
              Nothing about when the memory was written — only when it was anchored, which is
              whenever its owner chose to.
            </li>
          </ul>
        </section>
      </main>

      <footer className="pb-12 pt-10 text-xs text-ink-faint">
        Reading {NETWORK} · program {PROGRAM_ID.slice(0, 8)}…
      </footer>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="break-all font-mono text-xs text-ink">{value}</dd>
    </div>
  );
}

function areEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
