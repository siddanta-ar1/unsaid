'use client';

import { useEffect, useRef, useState } from 'react';
import { createVault, sealText, toBase64Url } from '@unsaid/crypto';

/**
 * The claim, running in the visitor's own browser.
 *
 * Everything here is the real thing: the same `createVault` and `sealText` the
 * product uses, the same 600,000-round key derivation, the same AES-GCM. It is
 * not an animation of encryption — nothing is faked, and the millisecond
 * figures are measured on the visitor's own device as it happens.
 *
 * That is the point. A paragraph claiming "encrypted before it leaves your
 * device" asks to be believed; this runs it with the visitor's own sentence
 * and shows both halves, so the claim can be checked instead.
 *
 * Nothing here is sent anywhere. There is no network call in this component,
 * which is the one fact about it worth stating on the page itself.
 */

const EXAMPLE = 'I have not told anyone how tired I am.';

type Phase = 'idle' | 'working' | 'done' | 'unsupported';

type Result = {
  ciphertext: string;
  deriveMs: number;
  sealMs: number;
  plaintextBytes: number;
  storedBytes: number;
};

export function LiveSeal() {
  const [text, setText] = useState(EXAMPLE);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const keyRef = useRef<CryptoKey | null>(null);
  const deriveMsRef = useRef(0);

  // WebCrypto needs a secure context. On http:// over a LAN the whole demo is
  // unavailable, and saying so is better than a button that does nothing.
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.crypto?.subtle) setPhase('unsupported');
  }, []);

  async function seal() {
    if (phase === 'unsupported') return;
    setPhase('working');

    // Yield once so the button's pressed state paints before the main thread
    // disappears into the KDF for the better part of a second.
    await new Promise((resolve) => setTimeout(resolve, 16));

    try {
      if (!keyRef.current) {
        const startedAt = performance.now();
        const vault = await createVault('a demonstration phrase, never stored');
        deriveMsRef.current = performance.now() - startedAt;
        keyRef.current = vault.vaultKey;
      }

      const body = text.trim() || EXAMPLE;
      const sealStartedAt = performance.now();
      const sealed = await sealText(body, keyRef.current, 1);
      const sealMs = performance.now() - sealStartedAt;

      const ciphertext = toBase64Url(sealed.ciphertext);
      setResult({
        ciphertext,
        deriveMs: deriveMsRef.current,
        sealMs,
        plaintextBytes: new TextEncoder().encode(body).byteLength,
        // Counted the same way `scripts/bench-client.mjs` counts it — the
        // ciphertext, both JSON envelopes AND the content hash — so the figure
        // a visitor sees here matches the +218 B in docs/paper/benchmarks.md
        // rather than quietly disagreeing with our own published number.
        storedBytes:
          sealed.ciphertext.byteLength +
          JSON.stringify(sealed.header).length +
          JSON.stringify(sealed.wrappedKey).length +
          sealed.contentHash.length,
      });
      setPhase('done');
    } catch {
      setPhase('unsupported');
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-paper-raised p-5 sm:p-7">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs uppercase tracking-[0.14em] text-accent">Try it right here</p>
        <h3 className="font-serif text-xl text-ink sm:text-2xl">
          Write something. Watch it become unreadable.
        </h3>
        <p className="text-sm leading-relaxed text-ink-soft">
          This runs the product&rsquo;s actual encryption in your browser, on your words. Nothing
          is sent anywhere — there is no network request on this page.
        </p>
      </div>

      <label htmlFor="live-seal" className="mt-5 block text-sm text-ink-soft">
        Your sentence
        <textarea
          id="live-seal"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPhase('idle');
            setResult(null);
          }}
          rows={2}
          maxLength={280}
          className="mt-2 w-full min-w-0 resize-none rounded-xl border border-field bg-paper px-4 py-3 font-serif text-base text-ink outline-none"
        />
      </label>

      {phase !== 'unsupported' && (
        <button
          type="button"
          onClick={seal}
          disabled={phase === 'working'}
          className="mt-3 rounded-xl bg-ink px-6 py-3 text-base text-paper disabled:opacity-70"
        >
          {phase === 'working'
            ? 'Deriving your key — 600,000 rounds…'
            : result
              ? 'Encrypt it again'
              : 'Encrypt it'}
        </button>
      )}

      {phase === 'unsupported' && (
        <p className="mt-3 rounded-xl border border-caution bg-caution-wash px-4 py-3 text-sm leading-relaxed text-ink">
          This demo needs WebCrypto, which browsers only provide over HTTPS. The product itself
          has the same requirement — it will not run without it.
        </p>
      )}

      {result && (
        <div className="mt-6 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-caution bg-caution-wash p-4">
              <p className="text-xs uppercase tracking-[0.12em] text-caution">
                Stays on your device
              </p>
              <p className="mt-2 font-serif text-base leading-relaxed text-ink">
                {text.trim() || EXAMPLE}
              </p>
            </div>
            <div className="rounded-xl border border-safe bg-safe-wash p-4">
              <p className="text-xs uppercase tracking-[0.12em] text-safe">
                All we would ever hold
              </p>
              <p className="mt-2 break-all font-mono text-[11px] leading-[1.5] text-ink-soft">
                {result.ciphertext}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Key derivation" value={`${result.deriveMs.toFixed(0)} ms`} note="once per unlock" />
            <Stat label="Encrypting" value={`${result.sealMs.toFixed(1)} ms`} note="every time" />
            <Stat label="You wrote" value={`${result.plaintextBytes} B`} note="plaintext" />
            <Stat
              label="We would store"
              value={`${result.storedBytes} B`}
              note={`+${result.storedBytes - result.plaintextBytes} B overhead`}
            />
          </dl>

          <p className="text-sm leading-relaxed text-ink-faint">
            Those numbers came from your device just now, not from our marketing. The slow part is
            deliberate: 600,000 rounds is what makes a stolen copy of our database worthless.
            Encrypting itself is the fast part, and it is the part that happens every time you
            write.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-1 font-serif text-xl text-ink">{value}</dd>
      <dd className="text-xs text-ink-faint">{note}</dd>
    </div>
  );
}
