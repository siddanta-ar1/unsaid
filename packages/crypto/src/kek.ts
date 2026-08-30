import { ENVELOPE_VERSION, type KdfParams } from '@unsaid/types';
import { fromBase64Url, timingSafeEqual, toBase64Url } from './encoding.js';
import { PBKDF2_ITERATIONS, SALT_BYTES, getCrypto, randomBytes, sha256 } from './primitives.js';

/**
 * The key-encryption key (KEK) never leaves the device and is never persisted.
 * It is re-derived from the user's passphrase on each unlock, and is used only
 * to wrap and unwrap per-thought content keys.
 */

const KEK_USAGES: KeyUsage[] = ['wrapKey', 'unwrapKey'];

export interface DerivedKek {
  key: CryptoKey;
  params: KdfParams;
}

export function newKdfParams(): KdfParams {
  return {
    v: ENVELOPE_VERSION,
    alg: 'PBKDF2-SHA256',
    salt: toBase64Url(randomBytes(SALT_BYTES)),
    iterations: PBKDF2_ITERATIONS,
  };
}

export async function deriveKek(passphrase: string, params: KdfParams): Promise<CryptoKey> {
  const subtle = getCrypto().subtle;
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64Url(params.salt) as BufferSource,
      iterations: params.iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-KW', length: 256 },
    false, // non-extractable: the KEK itself can never be read back out.
    KEK_USAGES,
  );
}

/**
 * Creates a value the server can store to check a passphrase without learning
 * it. Deriving a second, independent hash from the same passphrase would leak
 * an offline-crackable target, so instead we wrap a known constant with the KEK
 * — verifying requires successfully unwrapping it.
 */
const VERIFIER_PLAINTEXT = new Uint8Array(32); // all zeroes, a fixed known value

export async function createVerifier(kek: CryptoKey): Promise<string> {
  const subtle = getCrypto().subtle;
  const known = await subtle.importKey(
    'raw',
    VERIFIER_PLAINTEXT as BufferSource,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  );
  const wrapped = await subtle.wrapKey('raw', known, kek, 'AES-KW');
  return toBase64Url(new Uint8Array(wrapped));
}

export async function verifyPassphrase(kek: CryptoKey, verifier: string): Promise<boolean> {
  const subtle = getCrypto().subtle;
  try {
    const unwrapped = await subtle.unwrapKey(
      'raw',
      fromBase64Url(verifier) as BufferSource,
      kek,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt'],
    );
    const raw = new Uint8Array(await subtle.exportKey('raw', unwrapped));
    return timingSafeEqual(raw, VERIFIER_PLAINTEXT);
  } catch {
    // AES-KW integrity check failed: wrong passphrase.
    return false;
  }
}

/**
 * A stable, non-reversible account handle derived from the passphrase salt.
 * Lets a returning user find their record without the server storing an email.
 */
export async function deriveAccountLookup(params: KdfParams): Promise<string> {
  return toBase64Url(await sha256(fromBase64Url(params.salt)));
}

export async function deriveKekWithParams(
  passphrase: string,
  params: KdfParams,
): Promise<DerivedKek> {
  return { key: await deriveKek(passphrase, params), params };
}
