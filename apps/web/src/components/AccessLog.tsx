'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useVault } from '@/lib/vault';
import {
  checkOnChain,
  explorerAccountUrl,
  getActivity,
  type ActivityItem,
  type ActivityResponse,
  type ChainCheck,
} from '@/lib/activity';

/**
 * The access log.
 *
 * Everywhere else in this product we ask to be believed. Here the user does not
 * have to: each row is read back from the chain at an address this component
 * derives itself, and it says plainly when our answer and the chain's disagree.
 *
 * What it never shows is content. The log is metadata by construction — it can
 * say a memory was read without being able to say what it said.
 *
 * `load` and `check` are injectable so the rendered states can be tested
 * without a server or a validator; nothing else should pass them.
 */
export function AccessLog({
  load = getActivity,
  check = checkOnChain,
}: {
  load?: (token: string) => Promise<ActivityResponse>;
  check?: typeof checkOnChain;
} = {}) {

  const { token } = useVault();
  const [subject, setSubject] = useState<string | null>(null);
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [checks, setChecks] = useState<Record<string, ChainCheck>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    load(token)
      .then((response) => {
        setSubject(response.subject);
        setItems(response.items);
      })
      .catch(() => setError('Your access log could not be loaded right now.'));
  }, [token, load]);

  // Checked one at a time rather than in parallel: a public RPC will rate-limit
  // a burst, and a row that reads "could not be checked" because we were
  // throttled is indistinguishable from one that is genuinely missing.
  const verify = useCallback(
    async (item: ActivityItem) => {
      if (!subject || checks[item.receiptId]) return;
      setChecks((current) => ({ ...current, [item.receiptId]: { state: 'checking' } }));
      try {
        const result = await check(subject, item);
        setChecks((current) => ({ ...current, [item.receiptId]: result }));
      } catch {
        setChecks((current) => ({
          ...current,
          [item.receiptId]: { state: 'missing', recordAddress: '' },
        }));
      }
    },
    [subject, checks, check],
  );

  if (error) return <p role="alert" className="py-16 text-sm text-ember">{error}</p>;
  if (!items) return <p className="py-16 text-sm text-ink-faint">Reading your access log…</p>;

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-serif text-2xl text-ink">Nothing has ever opened a memory.</h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
          Not us, not anything we use. If that ever changes, it will appear here — and on a public
          ledger we cannot edit, so this page is not the only place you can check.
        </p>
        <Link href="/vault" className="mt-8 self-start text-sm text-ink underline underline-offset-4">
          Back to your vault
        </Link>
      </div>
    );
  }

  return (
    <div className="py-8">
      <h1 className="font-serif text-2xl text-ink">What has touched your memories</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
        {items.length} {items.length === 1 ? 'access' : 'accesses'}. Each one was written to Solana
        when it happened. Check any of them and this page reads the record straight from the chain —
        if we were telling you something different, it would say so.
      </p>

      <ul className="mt-8 flex list-none flex-col gap-0 divide-y divide-line border-t border-line p-0">
        {items.map((item) => (
          <Row
            key={item.receiptId}
            item={item}
            check={checks[item.receiptId]}
            onVerify={() => void verify(item)}
          />
        ))}
      </ul>

      <p className="mt-10 max-w-prose text-xs leading-relaxed text-ink-faint">
        A row marked <em>not published</em> is one we recorded but could not write to the chain.
        It is shown rather than hidden: a log that quietly dropped what it failed to record would
        look complete while being wrong about the only thing it is for.
      </p>
    </div>
  );
}

const PURPOSE_LABEL: Record<ActivityItem['purpose'], string> = {
  reflection: 'Echo read this memory',
  reflection_unattested: 'Echo read this memory',
  export: 'You exported your vault',
  share: 'You shared a way in',
};

function Row({
  item,
  check,
  onVerify,
}: {
  item: ActivityItem;
  check: ChainCheck | undefined;
  onVerify: () => void;
}) {
  const attested = item.purpose === 'reflection';
  const when = new Date(item.at);

  return (
    <li className="flex flex-col gap-3 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-ink">{PURPOSE_LABEL[item.purpose]}</span>
        <span className="text-xs text-ink-faint">
          {when.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
          {when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {attested ? (
          <Badge tone="ink">Attested</Badge>
        ) : (
          /* Not a warning — a fact, and the one the user should be able to see. */
          <Badge tone="faint">No proof of what ran</Badge>
        )}
        <Badge tone="faint">Consent v{item.consentVersion}</Badge>
        {item.status !== 'confirmed' && <Badge tone="ember">Not published</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <Link
          href={`/vault/${item.thoughtId}`}
          className="text-ink-faint underline underline-offset-4 hover:text-ink-soft"
        >
          Open the memory
        </Link>

        {item.status === 'confirmed' && !check && (
          <button
            type="button"
            onClick={onVerify}
            className="text-ink underline underline-offset-4 hover:text-ink-soft"
          >
            Check the chain
          </button>
        )}

        {check?.state === 'checking' && <span className="text-ink-faint">Reading the chain…</span>}

        {check?.state === 'matches' && (
          <span className="text-ink-soft">
            Matches the chain, recorded {check.recordedAt.toLocaleString()} ·{' '}
            <a
              href={explorerAccountUrl(check.recordAddress, item.network)}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-4"
            >
              see it
            </a>
          </span>
        )}

        {check?.state === 'missing' && (
          <span className="text-ember">
            We said this was published, and the chain has no record of it.
          </span>
        )}

        {check?.state === 'differs' && (
          <span className="text-ember">
            The chain disagrees with us about the {check.fields.join(', ')}.
          </span>
        )}
      </div>
    </li>
  );
}

function Badge({ tone, children }: { tone: 'ink' | 'faint' | 'ember'; children: React.ReactNode }) {
  const toneClass =
    tone === 'ink'
      ? 'border-field text-ink'
      : tone === 'ember'
        ? 'border-ember text-ember'
        : 'border-line text-ink-faint';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${toneClass}`}>
      {children}
    </span>
  );
}
