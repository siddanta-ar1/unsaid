import { ENVELOPE_VERSION, type KdfParams } from '@unsaid/types';
import { fromBase64Url, toBase64Url } from './encoding.js';
import { deriveKek, newKdfParams } from './kek.js';
import { getCrypto, randomBytes } from './primitives.js';

/**
 * The vault key layer.
 *
 * Content keys are wrapped under a single long-lived **vault key** (VK), and
 * the VK is itself wrapped once per way of getting in — today the passphrase
 * and the recovery kit. Nothing else ever wraps a content key.
 *
 * That indirection buys three things the direct design could not give us:
 *
 *   - **Recovery.** A forgotten passphrase is survivable, because the recovery
 *     kit holds a second wrapped copy of the same VK. Without this, a lost
 *     passphrase means every memory is gone forever — true to the crypto, and
 *     fatal as a first experience.
 *   - **Cheap rotation.** Changing a passphrase re-wraps one key, not one key
 *     per thought. The ciphertext is never touched and never re-uploaded.
 *   - **More ways in later** (a second device, a hardware key) without another
 *     migration.
 *
 * The server stores only wrapped copies. Holding two locked boxes instead of
 * one tells it nothing it did not already not know.
 */

/** The VK wraps content keys, so it needs exactly these usages. */
const VAULT_KEY_USAGES: KeyUsage[] = ['wrapKey', 'unwrapKey'];

export class VaultKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultKeyError';
  }
}

/**
 * Crockford base32: no I, L, O or U. Those are the characters people
 * mistranscribe when copying a code off a printed page, which is exactly how
 * this one travels.
 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_BYTES = 20; // 160 bits — far beyond guessing, still transcribable.
const RECOVERY_GROUP = 4;

export interface VaultKeyMaterial {
  /** Wrapped under the passphrase-derived key. */
  kdf: KdfParams;
  wrappedVaultKey: string;
}

export interface RecoveryMaterial {
  /** Wrapped under the recovery-code-derived key. */
  kdf: KdfParams;
  wrappedVaultKey: string;
}

export interface NewVault {
  vaultKey: CryptoKey;
  passphrase: VaultKeyMaterial;
  recovery: RecoveryMaterial;
  /** Proof of possession, stored by the server and compared at login. */
  loginProof: string;
  /** Shown to the user exactly once. Never persisted anywhere by us. */
  recoveryCode: string;
}

/** Generates a fresh, extractable vault key. Extractable so it can be wrapped. */
function generateVaultKey(): Promise<CryptoKey> {
  return getCrypto().subtle.generateKey({ name: 'AES-KW', length: 256 }, true, VAULT_KEY_USAGES);
}

async function wrapVaultKey(vaultKey: CryptoKey, kek: CryptoKey): Promise<string> {
  const wrapped = await getCrypto().subtle.wrapKey('raw', vaultKey, kek, 'AES-KW');
  return toBase64Url(new Uint8Array(wrapped));
}

async function unwrapVaultKey(wrapped: string, kek: CryptoKey): Promise<CryptoKey> {
  try {
    return await getCrypto().subtle.unwrapKey(
      'raw',
      fromBase64Url(wrapped) as BufferSource,
      kek,
      'AES-KW',
      { name: 'AES-KW', length: 256 },
      true,
      VAULT_KEY_USAGES,
    );
  } catch {
    // AES-KW carries its own integrity check, so a failure here means the
    // derived key was wrong — the wrong passphrase or the wrong code.
    throw new VaultKeyError('That did not unlock this vault.');
  }
}

/**
 * Formats raw bytes as a grouped recovery code.
 *
 * Grouping is not decoration: it is what makes a code possible to read off a
 * screen and type into another device without losing your place.
 */
export function encodeRecoveryCode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];

  return (output.match(new RegExp(`.{1,${RECOVERY_GROUP}}`, 'g')) ?? []).join('-');
}

/**
 * Accepts a code however the user typed it — spaces, missing dashes, lower
 * case — and maps the characters people habitually confuse onto the right
 * ones. Rejecting a correct code because someone typed O for 0 would be a
 * cruel way to lose a vault.
 */
export function normaliseRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

/**
 * Creates a vault: one key, wrapped two ways.
 *
 * Returns the recovery code in the clear because this is the only moment it
 * can ever be shown. We derive a key from it, wrap the VK, and keep nothing.
 */
export async function createVault(passphrase: string): Promise<NewVault> {
  const vaultKey = await generateVaultKey();

  const passphraseKdf = newKdfParams();
  const passphraseKek = await deriveKek(passphrase, passphraseKdf);

  const recoveryCode = encodeRecoveryCode(randomBytes(RECOVERY_BYTES));
  const recoveryKdf = newKdfParams();
  const recoveryKek = await deriveKek(normaliseRecoveryCode(recoveryCode), recoveryKdf);

  return {
    vaultKey,
    passphrase: {
      kdf: passphraseKdf,
      wrappedVaultKey: await wrapVaultKey(vaultKey, passphraseKek),
    },
    recovery: {
      kdf: recoveryKdf,
      wrappedVaultKey: await wrapVaultKey(vaultKey, recoveryKek),
    },
    loginProof: await deriveLoginProof(vaultKey),
    recoveryCode,
  };
}

/**
 * Unlocks with a passphrase. A wrong passphrase throws here rather than
 * silently producing a key that decrypts nothing — so the separate verifier
 * the old design stored is no longer needed. The wrapped key is the verifier.
 */
export async function unlockWithPassphrase(
  passphrase: string,
  material: VaultKeyMaterial,
): Promise<CryptoKey> {
  const kek = await deriveKek(passphrase, material.kdf);
  return unwrapVaultKey(material.wrappedVaultKey, kek);
}

export async function unlockWithRecoveryCode(
  code: string,
  material: RecoveryMaterial,
): Promise<CryptoKey> {
  const kek = await deriveKek(normaliseRecoveryCode(code), material.kdf);
  return unwrapVaultKey(material.wrappedVaultKey, kek);
}

/**
 * Re-wraps the vault key under a new passphrase.
 *
 * Content keys and ciphertext are untouched: nothing is re-uploaded, and no
 * historical object is rewritten. The recovery kit keeps working, because it
 * wraps the same VK.
 */
export async function changePassphrase(
  vaultKey: CryptoKey,
  newPassphrase: string,
): Promise<VaultKeyMaterial> {
  const kdf = newKdfParams();
  const kek = await deriveKek(newPassphrase, kdf);
  return { kdf, wrappedVaultKey: await wrapVaultKey(vaultKey, kek) };
}

/** Issues a fresh recovery kit, invalidating the previous one. */
export async function regenerateRecoveryKit(
  vaultKey: CryptoKey,
): Promise<{ recovery: RecoveryMaterial; recoveryCode: string }> {
  const recoveryCode = encodeRecoveryCode(randomBytes(RECOVERY_BYTES));
  const kdf = newKdfParams();
  const kek = await deriveKek(normaliseRecoveryCode(recoveryCode), kdf);
  return {
    recovery: { kdf, wrappedVaultKey: await wrapVaultKey(vaultKey, kek) },
    recoveryCode,
  };
}

/**
 * A stable proof that the caller holds the vault key.
 *
 * The vault id is not a secret: it is printed on the recovery kit and shown in
 * settings so a second device can find the vault. A session, however, is not a
 * read-only capability — it authorises deleting a memory, forgetting one
 * irreversibly, and overwriting the wrapped vault key. So the bar for issuing
 * one has to be possession of the key itself.
 *
 * AES-KW is deterministic, so wrapping a fixed constant under the vault key
 * yields a stable value that only a holder of that key can produce. It is
 * derived from the *vault key* rather than the passphrase, which means the
 * recovery kit reaches the same proof and a passphrase change does not
 * invalidate it.
 *
 * The server stores this value to compare against, so anyone already holding
 * the database could replay it — but they hold the ciphertext too, and it
 * remains unreadable. What this stops is the far likelier case: someone who
 * merely saw a vault id.
 */
const LOGIN_PROOF_PLAINTEXT = new Uint8Array(32).fill(0x5a);

export async function deriveLoginProof(vaultKey: CryptoKey): Promise<string> {
  const subtle = getCrypto().subtle;
  const known = await subtle.importKey(
    'raw',
    LOGIN_PROOF_PLAINTEXT as BufferSource,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  );
  const wrapped = await subtle.wrapKey('raw', known, vaultKey, 'AES-KW');
  return toBase64Url(new Uint8Array(wrapped));
}

/**
 * The printable kit. Carries the vault id alongside the code so that signing
 * in on a second device needs one piece of paper rather than a pasted UUID
 * the user was never given a good way to keep.
 */
export function formatRecoveryKit(vaultId: string, recoveryCode: string, issuedAt = new Date()) {
  return [
    'UNSAID RECOVERY KIT',
    '',
    'Keep this somewhere safe and offline. Anyone holding it can open your',
    'vault. We cannot send you another copy, and we cannot recover your',
    'memories without it.',
    '',
    `Vault ID:       ${vaultId}`,
    `Recovery code:  ${recoveryCode}`,
    `Issued:         ${issuedAt.toISOString().slice(0, 10)}`,
    '',
    'To use it: open UNSAID, choose "I lost my phrase", and enter both lines',
    'above. You will then set a new phrase.',
    '',
    `Format version ${ENVELOPE_VERSION}`,
  ].join('\n');
}
