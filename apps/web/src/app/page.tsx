import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { WaitlistForm } from '@/components/WaitlistForm';

/**
 * The landing page.
 *
 * Blueprint §24.1: lead with the human problem, not the blockchain. The
 * ownership story only lands once someone already wants the thing, so Solana
 * appears once, low on the page, as a trust detail rather than a headline.
 *
 * This also fixes the steepest wall in the product. Previously a first-time
 * visitor met "choose a phrase to lock your vault" before understanding what
 * the vault was for — the top risk in the shipping plan. Now they read one
 * screen first and arrive at the passphrase already knowing why it matters.
 */
export const metadata: Metadata = {
  title: 'UNSAID — a private place for the things you cannot say out loud',
  description:
    'Speak, write, reflect, or let it go. Encrypted on your device before it reaches us. We cannot read what you write here.',
  // The app itself is noindex; this page is the one that should be found.
  robots: { index: true, follow: true },
};

export default function LandingPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6">
      <header className="flex items-baseline justify-between py-8">
        <Logo withWordmark className="text-ink" />
        <nav className="flex gap-6 text-sm text-ink-soft">
          <Link href="/privacy" className="hover:text-ink">
            How it works
          </Link>
          <Link href="/app" className="hover:text-ink">
            Open my vault
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="py-14">
          <h1 className="max-w-[18ch] font-serif text-4xl leading-[1.15] text-ink">
            Not every thought needs an audience.
          </h1>
          <p className="mt-6 max-w-prose text-lg leading-relaxed text-ink-soft">
            Sometimes it only needs somewhere to exist. UNSAID is a private place to say the
            things you would rather not say out loud — to anyone.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/app"
              className="rounded-xl bg-ink px-7 py-4 text-lg text-paper hover:opacity-90"
            >
              Say something
            </Link>
            <span className="text-sm text-ink-faint">No account. No email. No audience.</span>
          </div>
        </section>

        <section className="border-t border-line py-12">
          <h2 className="font-serif text-2xl text-ink">You do not always need advice</h2>
          <p className="mt-4 max-w-prose leading-relaxed text-ink-soft">
            There is a moment — usually late — when something needs to come out, but you are not
            sure you want a conversation about it. Messaging a friend asks them to carry it.
            Posting invites an audience. A blank document asks you to organise thoughts you have
            not organised yet.
          </p>
          <p className="mt-4 max-w-prose leading-relaxed text-ink-soft">
            So you say nothing, and it stays with you.
          </p>
        </section>

        <section className="border-t border-line py-12">
          <h2 className="font-serif text-2xl text-ink">What happens here</h2>
          <dl className="mt-8 flex flex-col gap-8">
            {[
              {
                term: 'Speak or write, immediately',
                detail:
                  'One tap to talk, one to write. No title, no tags, no categories to choose before you have said anything.',
              },
              {
                term: 'Then decide what it was for',
                detail:
                  'Keep it privately, ask Echo to reflect on it, or let it go. Nothing is saved anywhere until you choose.',
              },
              {
                term: 'It is encrypted before it leaves your device',
                detail:
                  'With a key we never receive. What reaches our servers is a file of random-looking bytes. We cannot read it, and neither can anyone who takes our database.',
              },
              {
                term: 'You can leave with everything',
                detail:
                  'One button exports every word, decrypted, as ordinary files that open without us — on any computer, years from now.',
              },
            ].map((item) => (
              <div key={item.term}>
                <dt className="text-base text-ink">{item.term}</dt>
                <dd className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-soft">
                  {item.detail}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-line py-12">
          <h2 className="font-serif text-2xl text-ink">What we will not do</h2>
          <ul className="mt-6 flex max-w-prose flex-col gap-3 text-sm leading-relaxed text-ink-soft">
            <li>We will not read what you write. We built it so that we cannot.</li>
            <li>We will not sell your data, or use it to target anything at you.</li>
            <li>We will not train models on your memories.</li>
            <li>We will not give you a follower count, a streak, or a reason to perform.</li>
            <li>
              We will not pretend to be therapy. UNSAID is not a clinical service and cannot
              assess how you are.
            </li>
          </ul>
        </section>

        <section className="border-t border-line py-12">
          <h2 className="font-serif text-2xl text-ink">The honest caveat</h2>
          <p className="mt-4 max-w-prose leading-relaxed text-ink-soft">
            Nothing is unbreakable. A device that is already compromised can read what you type
            before we ever encrypt it, and we will never claim otherwise. What we do promise is
            narrower and testable: a leak of our database or our storage does not expose what you
            wrote. If you lose your phrase and your recovery kit, your memories stay locked —
            permanently, including from us.
          </p>
          <Link
            href="/privacy"
            className="mt-5 inline-block text-sm text-ink underline underline-offset-4"
          >
            Read exactly how this works
          </Link>
        </section>

        <section className="border-t border-line py-12">
          <h2 className="font-serif text-2xl text-ink">Optional: proof it is yours</h2>
          <p className="mt-4 max-w-prose leading-relaxed text-ink-soft">
            If you want it, you can anchor a memory on Solana — publishing a one-way hash that
            proves it existed and is yours, without revealing a single word of it. Most people
            will never need this, and everything above works without a wallet.
          </p>
        </section>

        <section className="border-t border-line py-12">
          <h2 className="font-serif text-2xl text-ink">Early access</h2>
          <p className="mt-4 max-w-prose leading-relaxed text-ink-soft">
            We are opening this to a small group first, and would rather get it right for thirty
            people than be adequate for thousands. Leave an address if you want to be one of them.
          </p>
          <div className="mt-6">
            <WaitlistForm />
          </div>
        </section>
      </main>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line py-8 text-xs text-ink-faint">
        <Link href="/legal/privacy" className="hover:text-ink-soft">
          Privacy policy
        </Link>
        <Link href="/legal/terms" className="hover:text-ink-soft">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-ink-soft">
          How it works
        </Link>
        <span className="ml-auto">Not a crisis service.</span>
      </footer>
    </div>
  );
}
