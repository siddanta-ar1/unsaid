import Link from 'next/link';
import { JourneySteps } from '@/components/JourneySteps';
import { LiveSeal } from '@/components/LiveSeal';
import { Shell } from '@/components/Shell';
import { VisibilityLedger } from '@/components/VisibilityLedger';

/**
 * The Privacy Centre. Blueprint §11.5: a first-class screen, not a buried
 * policy page — and stated precisely enough to be falsifiable. Every claim
 * below corresponds to something enforced in code and covered by a test.
 *
 * It used to be six paragraphs. The claims have not changed; what changed is
 * that the two hardest ones to believe — "encrypted before it leaves" and
 * "here is everything we can see" — are now shown rather than asserted, and
 * the costs are in a panel of their own instead of buried in the fifth
 * paragraph where a hurried reader would miss them.
 */

const COSTS = [
  {
    title: 'If you lose your phrase',
    body: 'Your memories stay locked, permanently. We cannot reset it and we cannot recover what is inside — not for you, not for someone asking on your behalf, not for a court order. This is the direct cost of everything above. Decide whether you accept it before you rely on this.',
  },
  {
    title: 'What forgetting really does',
    body: 'Deleting removes the encrypted file and its record. Forgetting goes further: it destroys the key first, so even if a copy survived in a backup, nothing can ever read it again. That includes us. Neither can be undone.',
  },
  {
    title: 'When anything is read by AI',
    body: 'Only when you tap Reflect on one specific memory, and only after you have read the disclosure and confirmed it. That one memory is decrypted on your device and sent for a response; your other memories are never included. We record which model answered and when — never what was said.',
  },
  {
    title: 'What we do not promise',
    body: 'This is not unbreakable, and no system is. A device already compromised can read what you type before we ever encrypt it, and we do not promise anonymity from someone with access to your device or your network. We do promise that a leak of our database or our storage does not expose what you wrote.',
  },
] as const;

export default function PrivacyPage() {
  return (
    <Shell screen="privacy">
      <div className="py-6 sm:py-8">
        <h1 className="font-serif text-2xl text-ink sm:text-3xl">How this actually works</h1>
        <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
          A privacy promise you cannot check is not worth much. So rather than describe the
          encryption, this page runs it on your own words — and rather than summarise what we can
          see, it lists all of it.
        </p>

        <div className="mt-8">
          <LiveSeal />
        </div>

        <section className="mt-12 border-t border-line pt-8">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">Where each step happens</h2>
          <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
            Only two of these five touch our servers, and neither sees a readable word.
          </p>
          <div className="mt-7">
            <JourneySteps />
          </div>
        </section>

        <section className="mt-12 border-t border-line pt-8">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">What we can see</h2>
          <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
            Both lists are complete. There is no column in our database for a title, a
            transcript, a mood or a tag — not an empty one, not a hidden one, and a build that
            adds one fails our checks before it ships.
          </p>
          <div className="mt-7">
            <VisibilityLedger />
          </div>
        </section>

        <section className="mt-12 border-t border-line pt-8">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">
            What this costs you, stated plainly
          </h2>
          <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
            Protection this strong has consequences, and they are not footnotes.
          </p>
          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            {COSTS.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-line bg-paper-raised p-5"
              >
                <h3 className="text-base text-ink">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 border-t border-line pt-8">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">Check it without asking us</h2>
          <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
            Every access to a memory writes a content-free receipt to a public ledger we cannot
            edit. You can read those receipts straight from the chain, with none of our servers
            involved in the answer.
          </p>
          <Link
            href="/verify"
            className="mt-5 inline-block rounded-xl border border-field px-5 py-3 text-sm text-ink hover:border-ink"
          >
            Open the verifier
          </Link>
        </section>

        <p className="mt-12 border-t border-line pt-8 text-xs leading-relaxed text-ink-faint">
          UNSAID is not a therapy service, a crisis line, or a diagnostic tool. If you are in
          immediate danger, please contact a local emergency service or someone you trust.
        </p>
      </div>
    </Shell>
  );
}
