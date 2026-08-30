'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { SelectedWalletAccountContextProvider } from '@solana/react';
import type { UiWallet } from '@wallet-standard/react';

/**
 * Wallet plumbing.
 *
 * A wallet is optional everywhere in this app. Capture, the vault, deletion
 * and Echo all work with no wallet connected — connecting one only unlocks the
 * ability to anchor a proof of ownership (§14.5, D-04).
 *
 * This provider sits in the root layout so that settings and the proof panel
 * share one selection. It only *observes* the wallet-standard registry: no
 * connection is opened and no permission is requested until the user presses
 * Connect in settings. The connection UI and every signing path stay off the
 * capture screen entirely (§11.1).
 *
 * Note what is *not* here: the wallet address is never sent to our API except
 * as the owner of an anchor the user explicitly asked for, and it is never
 * stored alongside account data. Linking a wallet to ordinary vault activity
 * would hand a chain observer a correlation handle (§13.2).
 */

export const SOLANA_CHAINS = {
  devnet: 'solana:devnet',
  'mainnet-beta': 'solana:mainnet',
} as const;

export type SolanaNetwork = keyof typeof SOLANA_CHAINS;

const NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as SolanaNetwork) ?? 'devnet';

const RPC_URLS: Record<SolanaNetwork, string> = {
  devnet: process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.devnet.solana.com',
  'mainnet-beta': process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com',
};

interface SolanaConfig {
  network: SolanaNetwork;
  chain: (typeof SOLANA_CHAINS)[SolanaNetwork];
  rpc: Rpc<SolanaRpcApi>;
}

const SolanaConfigContext = createContext<SolanaConfig | null>(null);

/**
 * Only wallets that actually support the network we are anchoring on are
 * offered. Showing a wallet that will fail at signing time is worse than not
 * showing it.
 */
function walletSupportsChain(wallet: UiWallet): boolean {
  return wallet.chains.includes(SOLANA_CHAINS[NETWORK]);
}

/**
 * Remembers which wallet was chosen, so a returning user is not asked again.
 * This stores a wallet identifier only — never an address, and never a key.
 */
const STORAGE_KEY = 'unsaid.wallet';

const stateSync = {
  getSelectedWallet: () => {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  storeSelectedWallet: (accountKey: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, accountKey);
    } catch {
      // Private browsing; the choice simply is not remembered.
    }
  },
  deleteSelectedWallet: () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clean up.
    }
  },
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const config = useMemo<SolanaConfig>(
    () => ({
      network: NETWORK,
      chain: SOLANA_CHAINS[NETWORK],
      // Reads only: the blockhash for the transaction the wallet will sign.
      rpc: createSolanaRpc(RPC_URLS[NETWORK]),
    }),
    [],
  );

  return (
    <SolanaConfigContext.Provider value={config}>
      <SelectedWalletAccountContextProvider filterWallets={walletSupportsChain} stateSync={stateSync}>
        {children}
      </SelectedWalletAccountContextProvider>
    </SolanaConfigContext.Provider>
  );
}

export function useSolanaConfig(): SolanaConfig {
  const config = useContext(SolanaConfigContext);
  if (!config) throw new Error('useSolanaConfig must be used inside a WalletProvider.');
  return config;
}

/** Shortens an address for display. Full addresses are never shown inline. */
export function shortenAddress(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`;
}
