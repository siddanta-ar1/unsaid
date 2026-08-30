'use client';

import { useState } from 'react';
import {
  uiWalletAccountBelongsToUiWallet,
  useConnect,
  useDisconnect,
  type UiWallet,
  type UiWalletAccount,
} from '@wallet-standard/react';
import { useSelectedWalletAccount } from '@solana/react';
import { shortenAddress, useSolanaConfig } from '@/lib/wallet';

/**
 * Wallet connection UI. Blueprint §11.1: the wallet lives in settings and is
 * hidden until it is needed — it is never surfaced on the capture path, where
 * it would imply that anchoring is required.
 */
export function WalletConnect() {
  const [selectedAccount, setSelectedAccount, wallets] = useSelectedWalletAccount();
  const { network } = useSolanaConfig();
  const [error, setError] = useState<string | null>(null);

  if (selectedAccount) {
    // `useDisconnect` is bound to a wallet, not an account, so find the wallet
    // this account came from. It can be missing if the extension was removed
    // since the choice was stored — in that case we can still forget it locally.
    const owningWallet = wallets.find((wallet) =>
      uiWalletAccountBelongsToUiWallet(selectedAccount, wallet),
    );
    const forget = () => setSelectedAccount(undefined);

    return owningWallet ? (
      <ConnectedWallet account={selectedAccount} wallet={owningWallet} onDisconnected={forget} />
    ) : (
      <OrphanedWallet account={selectedAccount} onForget={forget} />
    );
  }

  if (wallets.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-paper-raised p-6">
        <p className="text-sm leading-relaxed text-ink-soft">
          No Solana wallet was detected in this browser. You do not need one — everything in
          UNSAID works without it. A wallet only lets you anchor proof that a memory is yours.
        </p>
        <a
          href="https://solana.com/solana-wallets"
          target="_blank"
          rel="noreferrer noopener"
          className="mt-4 inline-block text-sm text-ink underline underline-offset-4"
        >
          What is a wallet?
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-6">
      <p className="text-sm leading-relaxed text-ink-soft">
        Connecting a wallet lets you anchor a memory on Solana — a proof that it existed and is
        yours. Only a hash is published. Your words never leave your vault.
      </p>

      <ul className="mt-5 flex flex-col gap-2">
        {wallets.map((wallet) => (
          <WalletOption
            key={`${wallet.name}:${wallet.version}`}
            wallet={wallet}
            onConnected={(account) => {
              setError(null);
              setSelectedAccount(account);
            }}
            onError={setError}
          />
        ))}
      </ul>

      {error && <p className="mt-4 text-sm text-ember">{error}</p>}

      <p className="mt-5 text-xs leading-relaxed text-ink-faint">
        Connecting on <span className="text-ink-soft">{network}</span>. UNSAID never asks for a
        signature unless you are anchoring something.
      </p>
    </div>
  );
}

/**
 * One row per detected wallet. `useConnect` is a hook bound to a specific
 * wallet, so each option has to be its own component.
 */
function WalletOption({
  wallet,
  onConnected,
  onError,
}: {
  wallet: UiWallet;
  onConnected: (account: UiWalletAccount) => void;
  onError: (message: string) => void;
}) {
  const [isConnecting, connect] = useConnect(wallet);

  async function handleConnect() {
    try {
      const accounts = await connect();
      const account = accounts[0];
      if (!account) {
        onError(`${wallet.name} connected but offered no account.`);
        return;
      }
      onConnected(account);
    } catch {
      // A user closing the wallet popup is a normal outcome, not a failure to
      // report loudly.
      onError(`${wallet.name} did not complete the connection.`);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={handleConnect}
        disabled={isConnecting}
        className="flex w-full items-center gap-3 rounded-lg border border-line px-4 py-3 text-left text-sm text-ink hover:opacity-80 disabled:opacity-40"
      >
        {wallet.icon && (
          // eslint-disable-next-line @next/next/no-img-element -- data: URI from the wallet
          <img src={wallet.icon} alt="" aria-hidden className="size-5 rounded" />
        )}
        <span>{wallet.name}</span>
        <span className="ml-auto text-xs text-ink-faint">
          {isConnecting ? 'Waiting…' : 'Connect'}
        </span>
      </button>
    </li>
  );
}

function ConnectedWallet({
  account,
  wallet,
  onDisconnected,
}: {
  account: UiWalletAccount;
  wallet: UiWallet;
  onDisconnected: () => void;
}) {
  const [isDisconnecting, disconnect] = useDisconnect(wallet);

  async function handleDisconnect() {
    try {
      await disconnect();
    } finally {
      // Clear locally even if the wallet refused, so the UI never claims a
      // connection the user has asked to end.
      onDisconnected();
    }
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-6">
      <p className="text-xs uppercase tracking-wide text-ink-faint">Connected</p>
      <p className="mt-2 font-mono text-sm text-ink">{shortenAddress(account.address)}</p>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        This wallet can now anchor memories you choose. It is not linked to your vault, and
        nothing is signed without you approving it.
      </p>
      <button
        type="button"
        onClick={handleDisconnect}
        disabled={isDisconnecting}
        className="mt-5 text-sm text-ink-soft underline underline-offset-4 disabled:opacity-40"
      >
        {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
      </button>
    </div>
  );
}

function OrphanedWallet({
  account,
  onForget,
}: {
  account: UiWalletAccount;
  onForget: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper-raised p-6">
      <p className="text-xs uppercase tracking-wide text-ink-faint">Wallet unavailable</p>
      <p className="mt-2 font-mono text-sm text-ink">{shortenAddress(account.address)}</p>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        This wallet is no longer available in this browser. Nothing in your vault is affected.
      </p>
      <button
        type="button"
        onClick={onForget}
        className="mt-5 text-sm text-ink-soft underline underline-offset-4"
      >
        Forget this wallet
      </button>
    </div>
  );
}
