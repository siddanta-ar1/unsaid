'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { KdfParams } from '@unsaid/types';
import { createVerifier, deriveKek, newKdfParams } from '@unsaid/crypto';
import { apiFetch } from './api';

/**
 * Holds the unlocked vault key for the lifetime of the tab.
 *
 * The CryptoKey is non-extractable and lives only in React state — it is never
 * written to localStorage, sessionStorage, a cookie, or the URL. Closing the
 * tab locks the vault, which is the intended behaviour: the alternative is
 * persisting the one secret that makes every other protection meaningful.
 *
 * The session token is kept in sessionStorage so a page refresh does not log
 * the user out. That token alone is useless — it fetches ciphertext.
 */

const TOKEN_KEY = 'unsaid.session';
const USER_KEY = 'unsaid.user';

interface VaultState {
  userId: string | null;
  token: string | null;
  key: CryptoKey | null;
  keyVersion: number;
  isUnlocked: boolean;
  createVault: (passphrase: string) => Promise<void>;
  unlock: (userId: string, passphrase: string) => Promise<void>;
  lock: () => void;
}

const VaultContext = createContext<VaultState | null>(null);

function readStored(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Private browsing modes can throw; the app still works for this session.
  }
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(() => readStored(USER_KEY));
  const [token, setToken] = useState<string | null>(() => readStored(TOKEN_KEY));
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [keyVersion, setKeyVersion] = useState(1);

  const createVault = useCallback(async (passphrase: string) => {
    const kdf = newKdfParams();
    const derived = await deriveKek(passphrase, kdf);
    const verifier = await createVerifier(derived);

    const result = await apiFetch<{ userId: string; token: string }>('/v1/identity/guest', {
      method: 'POST',
      body: { kdf, verifier },
    });

    setUserId(result.userId);
    setToken(result.token);
    setKey(derived);
    setKeyVersion(1);
    writeStored(USER_KEY, result.userId);
    writeStored(TOKEN_KEY, result.token);
  }, []);

  const unlock = useCallback(async (id: string, passphrase: string) => {
    // The salt is public; only the passphrase turns it into a usable key.
    const session = await apiFetch<{
      keyMaterial: { kdf: KdfParams; keyVersion: number };
    }>(`/v1/identity/params/${id}`);

    const derived = await deriveKek(passphrase, session.keyMaterial.kdf);
    const verifier = await createVerifier(derived);

    const result = await apiFetch<{ userId: string; token: string }>('/v1/identity/login', {
      method: 'POST',
      body: { userId: id, verifier },
    });

    setUserId(result.userId);
    setToken(result.token);
    setKey(derived);
    setKeyVersion(session.keyMaterial.keyVersion);
    writeStored(USER_KEY, result.userId);
    writeStored(TOKEN_KEY, result.token);
  }, []);

  const lock = useCallback(() => {
    setKey(null);
    setToken(null);
    setUserId(null);
    writeStored(TOKEN_KEY, null);
    writeStored(USER_KEY, null);
  }, []);

  const value = useMemo<VaultState>(
    () => ({
      userId,
      token,
      key,
      keyVersion,
      isUnlocked: key !== null && token !== null,
      createVault,
      unlock,
      lock,
    }),
    [userId, token, key, keyVersion, createVault, unlock, lock],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultState {
  const context = useContext(VaultContext);
  if (!context) throw new Error('useVault must be used inside a VaultProvider.');
  return context;
}
