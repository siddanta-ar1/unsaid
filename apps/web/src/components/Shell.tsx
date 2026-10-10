'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { BackendNotice } from './BackendNotice';
import { FeedbackButton } from './FeedbackButton';
import { Logo } from './Logo';
import { trackReturn, type FeedbackScreen } from '@/lib/signals';

const DESTINATIONS = [
  { href: '/vault', label: 'Vault' },
  { href: '/activity', label: 'Activity' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/settings', label: 'Settings' },
] as const;

/** Page frame. Navigation is deliberately small and text-only. */
export function Shell({
  children,
  footer,
  screen,
}: {
  children: ReactNode;
  footer?: ReactNode;
  screen: FeedbackScreen;
}) {
  // Null outside an App Router context; an empty string just means nothing is
  // marked current, which is a better failure than a crashed page frame.
  const pathname = usePathname() ?? '';

  // Counted once per week per browser, against a key that rotates weekly.
  useEffect(() => {
    trackReturn();
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 sm:px-6">
      {/*
       * The header stacks under `sm`. Measured: the wordmark and four links
       * need 378px on one line, and a 390px phone leaves 342px after the
       * gutters — so side by side it overflowed on every common handset.
       */}
      <header className="flex flex-col gap-3 py-6 sm:flex-row sm:items-baseline sm:justify-between sm:py-8">
        <Link
          href="/app"
          className="self-start text-ink"
          aria-label="UNSAID — open my vault"
        >
          <Logo withWordmark />
        </Link>
        <nav aria-label="Sections" className="flex gap-5 text-sm text-ink-soft sm:gap-6">
          {DESTINATIONS.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                // Knowing where you are is not decoration: this is the only
                // orientation cue in a product with no page titles.
                aria-current={active ? 'page' : undefined}
                className={active ? 'text-ink underline underline-offset-4' : 'hover:text-ink'}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex flex-1 flex-col">
        <BackendNotice />
        {children}
      </main>
      {/* Bottom padding keeps the last line clear of the fixed feedback button,
          which otherwise strikes through it on short viewports. */}
      <footer className="pb-20 pt-8 text-xs text-ink-faint">
        {footer ?? 'Your thoughts are encrypted on this device before they are saved.'}
      </footer>
      <FeedbackButton screen={screen} />
    </div>
  );
}
