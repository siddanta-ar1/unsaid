import Link from 'next/link';
import { Logo } from '@/components/Logo';

/**
 * The app had no 404. A framework default page on a privacy product reads as
 * though something broke open, which is the last impression this should give.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6">
      <header className="py-8">
        <Link href="/" className="text-ink" aria-label="UNSAID — home">
          <Logo withWordmark />
        </Link>
      </header>
      <main className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-serif text-2xl text-ink">There is nothing at this address.</h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
          Your vault is untouched. Nothing here is ever addressable by guessing a link — a memory
          opens only on a device holding your phrase.
        </p>
        <Link
          href="/vault"
          className="mt-8 self-start rounded-lg border border-transparent bg-ink px-6 py-3 text-paper"
        >
          Back to your vault
        </Link>
      </main>
    </div>
  );
}
