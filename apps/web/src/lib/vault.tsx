'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { WrappedVaultKey } from '@unsaid/types';
import {
  changePassphrase,
  createVault,
  regenerateRecoveryKit,
  unlockWithPassphrase,
  unlockWithRecoveryCode,
} from '@unsaid/crypto';
import { apiFetch } from './api';
import { track } from './signals';

/**
 * Holds the unlocked vault key for the lifetime of the tab.
 *
 * The key is held only in React state — never localStorage, never a cookie,
 * never the URL. Closing the tab locks the vault, which is the intended
 * behaviour: persisting the one secret that makes every other protection
 * meaningful would undo all of them.
 *
 * The session token is kept in sessionStorage so a refresh does not eject the
 * user mid-thought. That token alone only fetches ciphertext.
 */

const TOKEN_KEY = 'unsaid.session';
const USER_KEY = 'unsaid.user';

interface UnlockMaterial {
  passphrase: WrappedVaultKey;
  recovery: WrappedVaultKey;
  keyVersion: number;
}

interface VaultState {
  userId: string | null;
  token: string | null;
  key: CryptoKey | null;
  keyVersion: number;
  isUnlocked: boolean;
  /** Set immediately after vault creation, shown once, then cleared. */
  pendingRecoveryCode: string | null;
  createNewVault: (passphrase: string) => Promise<void>;
  unlock: (userId: string, passphrase: string) => Promise<void>;
  recover: (userId: string, recoveryCode: string, newPassphrase: string) => Promise<void>;
  setPassphrase: (newPassphrase: string) => Promise<void>;
  reissueRecoveryKit: () => Promise<string>;
  acknowledgeRecoveryCode: () => void;
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
    // Private browsing modes throw; the app still works for this session.
  }
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(() => readStored(USER_KEY));
  const [token, setToken] = useState<string | null>(() => readStored(TOKEN_KEY));
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [keyVersion, setKeyVersion] = useState(1);
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<string | null>(null);

  const startSession = useCallback((id: string, sessionToken: string, vaultKey: CryptoKey) => {
    setUserId(id);
    setToken(sessionToken);
    setKey(vaultKey);
    writeStored(USER_KEY, id);
    writeStored(TOKEN_KEY, sessionToken);
  }, []);

  const createNewVault = useCallback(
    async (passphrase: string) => {
      const vault = await createVault(passphrase);

      const result = await apiFetch<{ userId: string; token: string }>('/v1/identity/guest', {
        method: 'POST',
        body: { passphrase: vault.passphrase, recovery: vault.recovery },
      });

      startSession(result.userId, result.token, vault.vaultKey);
      setKeyVersion(1);
      // Held in memory only, and only until the user confirms they have saved
      // it. We never send it anywhere and cannot show it again.
      setPendingRecoveryCode(vault.recoveryCode);

      track({ name: 'vault_created', platform: 'web' });
    },
    [startSession],
  );

  const fetchMaterial = useCallback(
    (id: string) => apiFetch<UnlockMaterial>(`/v1/identity/unlock/${id}`),
    [],
  );

  const unlock = useCallback(
    async (id: string, passphrase: string) => {
      const material = await fetchMaterial(id);
      // Unwrapping happens here, on the device. A wrong passphrase throws.
      const vaultKey = await unlockWithPassphrase(passphrase, material.passphrase);

      const result = await apiFetch<{ userId: string; token: string }>('/v1/identity/login', {
        method: 'POST',
        body: { userId: id },
      });

      startSession(result.userId, result.token, vaultKey);
      setKeyVersion(material.keyVersion);
    },
    [fetchMaterial, startSession],
  );

  /**
   * The path back from a forgotten passphrase. The kit unwraps the same vault
   * key, and the user immediately sets a new phrase so they are not left
   * depending on a piece of paper.
   */
  const recover = useCallback(
    async (id: string, recoveryCode: string, newPassphrase: string) => {
      const material = await fetchMaterial(id);
      const vaultKey = await unlockWithRecoveryCode(recoveryCode, material.recovery);

      const result = await apiFetch<{ userId: string; token: string }>('/v1/identity/login', {
        method: 'POST',
        body: { userId: id },
      });
      startSession(result.userId, result.token, vaultKey);
      setKeyVersion(material.keyVersion);

      const rewrapped = await changePassphrase(vaultKey, newPassphrase);
      await apiFetch('/v1/identity/rotate', {
        method: 'POST',
        token: result.token,
        body: { passphrase: rewrapped },
      });
    },
    [fetchMaterial, startSession],
  );

  const setPassphrase = useCallback(
    async (newPassphrase: string) => {
      if (!key || !token) throw new Error('The vault must be unlocked to change its phrase.');
      const rewrapped = await changePassphrase(key, newPassphrase);
      await apiFetch('/v1/identity/rotate', {
        method: 'POST',
        token,
        body: { passphrase: rewrapped },
      });
    },
    [key, token],
  );

  const reissueRecoveryKit = useCallback(async () => {
    if (!key || !token) throw new Error('The vault must be unlocked to reissue a kit.');
    const reissued = await regenerateRecoveryKit(key);
    await apiFetch('/v1/identity/rotate', {
      method: 'POST',
      token,
      body: { recovery: reissued.recovery },
    });
    return reissued.recoveryCode;
  }, [key, token]);

  const acknowledgeRecoveryCode = useCallback(() => setPendingRecoveryCode(null), []);

  const lock = useCallback(() => {
    setKey(null);
    setToken(null);
    setUserId(null);
    setPendingRecoveryCode(null);
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
      pendingRecoveryCode,
      createNewVault,
      unlock,
      recover,
      setPassphrase,
      reissueRecoveryKit,
      acknowledgeRecoveryCode,
      lock,
    }),
    [
      userId,
      token,
      key,
      keyVersion,
      pendingRecoveryCode,
      createNewVault,
      unlock,
      recover,
      setPassphrase,
      reissueRecoveryKit,
      acknowledgeRecoveryCode,
      lock,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultState {
  const context = useContext(VaultContext);
  if (!context) throw new Error('useVault must be used inside a VaultProvider.');
  return context;
}
