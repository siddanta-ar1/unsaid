import type { Metadata } from 'next';
import Link from 'next/link';
import { JourneySteps } from '@/components/JourneySteps';
import { LiveSeal } from '@/components/LiveSeal';
import { Logo } from '@/components/Logo';
import { VisibilityLedger } from '@/components/VisibilityLedger';
import { WaitlistForm } from '@/components/WaitlistForm';

/**
 * The landing page.
 *
 * Blueprint §24.1: lead with the human problem, not the blockchain. The
 * ownership story only lands once someone already wants the thing, so Solana
 * appears once, low on the page, as a trust detail rather than a headline.
 *
 * This page used to make its case in prose, which asked a visitor to believe
 * six paragraphs. It now makes the same case by running the encryption on
 * their own sentence, by letting them click through the five steps, and by
 * putting what we can see beside what we cannot. The claims are unchanged —
 * only the amount of reading required to check them.
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
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 sm:px-6">
      {/* Stacks under `sm`: the wordmark and three links do not fit one line on a phone. */}
      <header className="flex flex-col gap-3 py-6 sm:flex-row sm:items-baseline sm:justify-between sm:py-8">
        <Logo withWordmark className="self-start text-ink" />
        <nav aria-label="Primary" className="flex gap-5 text-sm text-ink-soft sm:gap-6">
          <Link href="/privacy" className="hover:text-ink">
            How it works
          </Link>
          <Link href="/verify" className="hover:text-ink">
            Verify
          </Link>
          <Link href="/app" className="hover:text-ink">
            Open my vault
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="py-10 sm:py-14">
          <h1 className="max-w-[18ch] font-serif text-[2rem] leading-[1.15] text-ink sm:text-4xl">
            Not every thought needs an audience.
          </h1>
          <p className="mt-5 max-w-prose leading-relaxed text-ink-soft sm:mt-6 sm:text-lg">
            Sometimes it only needs somewhere to exist. UNSAID is a private place to say the
            things you would rather not say out loud — to anyone.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4 sm:mt-10">
            <Link
              href="/app"
              className="rounded-xl bg-ink px-7 py-4 text-lg text-paper hover:opacity-90"
            >
              Say something
            </Link>
            <span className="text-sm text-ink-faint">No account. No email. No audience.</span>
          </div>
        </section>

        {/* The proof, before the prose. Everything below is elaboration on this. */}
        <section className="border-t border-line py-10 sm:py-12">
          <LiveSeal />
        </section>

        <section className="border-t border-line py-10 sm:py-12">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">You do not always need advice</h2>
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

        <section className="border-t border-line py-10 sm:py-12">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">
            What happens to one sentence
          </h2>
          <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
            Five steps, and the only two that touch our servers never see a readable word. Click
            through them.
          </p>
          <div className="mt-7">
            <JourneySteps />
          </div>
        </section>

        <section className="border-t border-line py-10 sm:py-12">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">Exactly what we can see</h2>
          <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">
            Both columns are complete. The left one is short because there is genuinely nothing
            else in it.
          </p>
          <div className="mt-7">
            <VisibilityLedger />
          </div>
        </section>

        <section className="border-t border-line py-10 sm:py-12">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">What you can do with it</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
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
                term: 'Read it back, years later',
                detail:
                  'Your vault is yours to reopen whenever you want. Unlocking takes about four tenths of a second.',
              },
              {
                term: 'Leave with everything',
                detail:
                  'One button exports every word, decrypted, as ordinary files that open without us — on any computer.',
              },
              {
                term: 'Make a memory truly gone',
                detail:
                  'Forgetting destroys the key first, so even a surviving backup is unreadable noise. Including to us.',
              },
              {
                term: 'Check what has touched it',
                detail:
                  'An access log, with the matching public record beside each entry, so our version can be compared.',
              },
            ].map((item) => (
              <div
                key={item.term}
                className="rounded-2xl border border-line bg-paper-raised p-5"
              >
                <h3 className="text-base text-ink">{item.term}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-line py-10 sm:py-12">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">What we will not do</h2>
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

        <section className="border-t border-line py-10 sm:py-12">
          <div className="rounded-2xl border border-caution bg-caution-wash p-5 sm:p-7">
            <p className="text-xs uppercase tracking-[0.14em] text-caution">The honest caveat</p>
            <h2 className="mt-2 font-serif text-xl text-ink sm:text-2xl">
              Nothing is unbreakable, and we will not claim otherwise
            </h2>
            <p className="mt-4 max-w-prose leading-relaxed text-ink">
              A device that is already compromised can read what you type before we ever encrypt
              it. We do not promise anonymity from someone with access to your device or your
              network. What we promise is narrower and testable: a leak of our database or our
              storage does not expose what you wrote. And if you lose your phrase and your
              recovery kit, your memories stay locked permanently — including from us.
            </p>
            <Link
              href="/privacy"
              className="mt-5 inline-block text-sm text-ink underline underline-offset-4"
            >
              Read exactly how this works
            </Link>
          </div>
        </section>

        <section className="border-t border-line py-10 sm:py-12">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">Optional: proof it is yours</h2>
          <p className="mt-4 max-w-prose leading-relaxed text-ink-soft">
            If you want it, you can anchor a memory on Solana — publishing a one-way hash that
            proves it existed and is yours, without revealing a single word of it. Every access to
            a memory also writes a content-free receipt there, so what we say happened can be
            checked against a record we cannot edit.
          </p>
          <p className="mt-4 max-w-prose leading-relaxed text-ink-soft">
            Most people will never need this, and everything above works without a wallet.
          </p>
          <Link
            href="/verify"
            className="mt-5 inline-block text-sm text-ink underline underline-offset-4"
          >
            Verify a proof yourself, without us
          </Link>
        </section>

        <section className="border-t border-line py-10 sm:py-12">
          <h2 className="font-serif text-xl text-ink sm:text-2xl">Early access</h2>
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
