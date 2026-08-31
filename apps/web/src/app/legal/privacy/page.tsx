import Link from 'next/link';
import { Shell } from '@/components/Shell';

export const metadata = { title: 'Privacy Policy — UNSAID' };

/**
 * The privacy policy.
 *
 * Derived from what the code actually does rather than from a template. Every
 * claim here corresponds to something enforced in the build and covered by a
 * test — if a claim below and the code ever disagree, the code is right and
 * this page is a bug.
 *
 * NOT YET REVIEWED BY A LAWYER. Before launch this needs a Nepal-qualified
 * privacy review against the Privacy Act 2075 and the Electronic Transactions
 * Act 2063, plus a review for every other launch jurisdiction.
 */
export default function PrivacyPolicyPage() {
  return (
    <Shell screen="privacy">
      <article className="prose-unsaid py-8">
        <h1 className="font-serif text-2xl text-ink">Privacy Policy</h1>
        <p className="mt-2 text-xs text-ink-faint">Last updated 30 August 2026</p>

        <Section title="The short version">
          We cannot read what you write here. Your memories are encrypted on your device before
          they reach us, with a key we never receive. What we hold is a file of random-looking
          bytes and a locked key we cannot open.
        </Section>

        <Section title="What we collect">
          <ul className="ml-4 list-disc space-y-1">
            <li>The encrypted contents of what you write or record.</li>
            <li>The date each memory was saved, whether it was text or voice, and its size.</li>
            <li>Key material that is useless without your phrase or recovery code.</li>
            <li>Operational records: error counts, request timings, rate-limit state.</li>
            <li>Product events, keyed by a random identifier that changes every week.</li>
          </ul>
          <p className="mt-3">
            We do not collect your name, email address, phone number, or location. There is no
            account to create. We do not use cookies for advertising or analytics.
          </p>
        </Section>

        <Section title="What we cannot collect">
          There is no column in our database capable of holding the text of a memory, a
          transcript, a title, or a tag. This is not a policy choice we could quietly reverse; it
          is the shape of the system, and our build fails if someone adds one.
        </Section>

        <Section title="When anything is read by AI">
          Only when you tap “Reflect” on one specific memory, and only after you have read the
          disclosure and confirmed it. That one memory is decrypted on your device and sent to our
          AI provider for a response. Your other memories are never included. We record which
          model answered and when — never what was said, in either direction.
        </Section>

        <Section title="Who we share with">
          <ul className="ml-4 list-disc space-y-1">
            <li>Our hosting, database, and storage providers, which hold only encrypted data.</li>
            <li>Our AI provider, and only the single memory you explicitly send.</li>
            <li>Our error-tracking provider, which receives scrubbed reports with no content.</li>
          </ul>
          <p className="mt-3">
            We do not sell your data. We do not use what you write to target advertising, and we
            do not use it to train models.
          </p>
        </Section>

        <Section title="Deletion">
          Deleting a memory removes the encrypted file and its record. Forgetting a memory
          destroys the key first, so that even a copy of the encrypted file surviving in a backup
          cannot be read again — by anyone, including us. Neither can be undone. If you anchor a
          memory on Solana, the public record of that transaction remains visible forever; it
          contains a one-way hash and never your words.
        </Section>

        <Section title="If you lose your phrase and your recovery kit">
          Your memories stay locked, permanently. We cannot reset them or recover them — not for
          you, not for anyone asking on your behalf, and not in response to a legal order, because
          we do not hold the key. This is the direct cost of everything above.
        </Section>

        <Section title="Your rights">
          You can export everything you have written at any time, decrypted, from Settings. You
          can delete any memory or your whole vault. Because we hold no identifying information,
          we cannot verify who you are for a data-subject request — the export and delete controls
          in the app are the mechanism, and they are always available to you.
        </Section>

        <Section title="Children">
          UNSAID is not intended for anyone under 16. We do not knowingly hold data from children.
        </Section>

        <Section title="Contact">
          Questions about this policy: <span className="font-mono text-ink">privacy@unsaid.app</span>
        </Section>

        <p className="mt-10 border-t border-line pt-6 text-xs leading-relaxed text-ink-faint">
          For how each of these works technically, see{' '}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-ink-soft">
            how this actually works
          </Link>
          .
        </p>
      </article>
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base text-ink">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}
