'use client';

import { useState } from 'react';

/**
 * The five steps a sentence takes, as something you click rather than read.
 *
 * The same content used to be a paragraph. A paragraph makes the reader hold
 * all five steps at once; this shows one at a time and keeps the others in
 * view as a map, so "where am I" is answered by looking rather than by
 * remembering.
 *
 * Each step says plainly which side of the trust boundary it happens on,
 * because that — not the sequence — is the thing worth taking away.
 */

const STEPS = [
  {
    n: '1',
    title: 'You write it',
    where: 'device',
    body: 'In the browser, with no title, no tags and no categories to choose first. Nothing has been sent at this point, and nothing is saved until you say so.',
    detail: 'There is no autosave and no draft sync. Close the tab here and the words are simply gone.',
  },
  {
    n: '2',
    title: 'Your device seals it',
    where: 'device',
    body: 'A fresh key is generated for this one memory and used to encrypt it. That key is then itself wrapped with a key derived from your phrase.',
    detail: 'AES-GCM-256 for the memory, AES-KW for the key, PBKDF2-SHA256 at 600,000 rounds for your phrase. Measured at 1.6 ms to seal a typed thought.',
  },
  {
    n: '3',
    title: 'Sealed bytes go to storage',
    where: 'ours',
    body: 'The encrypted file is uploaded straight to object storage using a short-lived link. Our API never holds the bytes as they pass.',
    detail: 'What lands in storage is random-looking data. We measured this: a sweep of 845 stored objects found zero traces of the plaintext.',
  },
  {
    n: '4',
    title: 'We file a stub',
    where: 'ours',
    body: 'A row recording the size, the timestamp, the type, and the wrapped key we cannot unwrap. That is the whole record.',
    detail: 'There is no column for a title, a transcript, a mood or a tag — not an empty one, not a hidden one. A build that adds one fails our CI.',
  },
  {
    n: '5',
    title: 'You read it back',
    where: 'device',
    body: 'Your phrase unwraps the key on your device, and the memory becomes words again. Only your device ever sees this step.',
    detail: 'Measured at 396 ms to unlock on a 2015 laptop. That wait is the security budget, and it is paid once per session.',
  },
] as const;

export function JourneySteps() {
  const [active, setActive] = useState(0);
  const step = STEPS[active]!;
  const onDevice = step.where === 'device';

  return (
    <div>
      {/* The map. Stays visible so the current step has a position, not just a number. */}
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((item, index) => {
          const current = index === active;
          const deviceStep = item.where === 'device';
          return (
            <li key={item.n}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-current={current ? 'step' : undefined}
                className={`rounded-full border px-4 py-2 text-sm ${
                  current
                    ? deviceStep
                      ? 'border-safe bg-safe-wash text-ink'
                      : 'border-caution bg-caution-wash text-ink'
                    : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                <span className="font-mono text-xs">{item.n}</span>
                <span className="ml-2">{item.title}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div
        className={`mt-5 rounded-2xl border p-5 sm:p-7 ${
          onDevice ? 'border-safe bg-safe-wash' : 'border-caution bg-caution-wash'
        }`}
      >
        <p
          className={`text-xs uppercase tracking-[0.14em] ${onDevice ? 'text-safe' : 'text-caution'}`}
        >
          {onDevice ? 'Happens on your device' : 'Happens on our servers'}
        </p>
        <h3 className="mt-2 font-serif text-xl text-ink sm:text-2xl">{step.title}</h3>
        <p className="mt-3 leading-relaxed text-ink">{step.body}</p>
        <p className="mt-3 border-t border-line pt-3 text-sm leading-relaxed text-ink-soft">
          {step.detail}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setActive((i) => Math.max(0, i - 1))}
          disabled={active === 0}
          className="rounded-lg border border-line px-4 py-2 text-sm text-ink-soft hover:text-ink disabled:opacity-40"
        >
          Back
        </button>
        <p className="text-sm text-ink-faint">
          Step {active + 1} of {STEPS.length}
        </p>
        <button
          type="button"
          onClick={() => setActive((i) => Math.min(STEPS.length - 1, i + 1))}
          disabled={active === STEPS.length - 1}
          className="rounded-lg border border-line px-4 py-2 text-sm text-ink-soft hover:text-ink disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
