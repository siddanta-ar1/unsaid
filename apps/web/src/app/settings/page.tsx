'use client';

import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { UnlockGate } from '@/components/UnlockGate';
import { WalletConnect } from '@/components/WalletConnect';
import { useVault } from '@/lib/vault';

/**
 * Settings. The wallet lives here rather than on the home screen, so that
 * nothing about the capture path implies a wallet is needed (§11.1).
 */
export default function SettingsPage() {
  return (
    <Shell>
      <UnlockGate>
        <SettingsScreen />
      </UnlockGate>
    </Shell>
  );
}

function SettingsScreen() {
  const { userId, lock } = useVault();

  return (
    <div className="py-8">
      <h1 className="font-serif text-2xl text-ink">Settings</h1>

      <section className="mt-10">
        <h2 className="text-base text-ink">Ownership</h2>
        <p className="mt-2 mb-5 text-sm leading-relaxed text-ink-soft">
          Optional. UNSAID works completely without this.
        </p>
        <WalletConnect />
      </section>

      <section className="mt-12">
        <h2 className="text-base text-ink">Your vault</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          This is the identifier for your vault. You need it, along with your phrase, to unlock
          your memories on another device. It is not a password and it is not enough on its own.
        </p>
        <p className="mt-4 break-all rounded-lg border border-line bg-paper-raised px-4 py-3 font-mono text-xs text-ink-soft">
          {userId}
        </p>
        <button
          type="button"
          onClick={lock}
          className="mt-5 text-sm text-ink-soft underline underline-offset-4"
        >
          Lock this vault now
        </button>
      </section>

      <section className="mt-12 border-t border-line pt-8">
        <p className="text-xs leading-relaxed text-ink-faint">
          Read{' '}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-ink-soft">
            how this actually works
          </Link>{' '}
          for what is stored, what is encrypted, and what happens when you delete.
        </p>
      </section>
    </div>
  );
}
