'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { FeedbackButton } from './FeedbackButton';
import { Logo } from './Logo';
import { trackReturn, type FeedbackScreen } from '@/lib/signals';

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
  // Counted once per week per browser, against a key that rotates weekly.
  useEffect(() => {
    trackReturn();
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6">
      <header className="flex items-baseline justify-between py-8">
        <Link href="/app" className="text-ink" aria-label="UNSAID — open my vault">
          <Logo withWordmark />
        </Link>
        <nav className="flex gap-6 text-sm text-ink-soft">
          <Link href="/vault" className="hover:text-ink">
            Vault
          </Link>
          <Link href="/activity" className="hover:text-ink">
            Activity
          </Link>
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/settings" className="hover:text-ink">
            Settings
          </Link>
        </nav>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
      {/* Bottom padding keeps the last line clear of the fixed feedback button,
          which otherwise strikes through it on short viewports. */}
      <footer className="pb-20 pt-8 text-xs text-ink-faint">
        {footer ?? 'Your thoughts are encrypted on this device before they are saved.'}
      </footer>
      <FeedbackButton screen={screen} />
    </div>
  );
}
