import { ENVELOPE_VERSION, type KdfParams } from '@unsaid/types';
import { fromBase64Url, toBase64Url } from './encoding.js';
import { PBKDF2_ITERATIONS, SALT_BYTES, getCrypto, randomBytes, sha256 } from './primitives.js';

/**
 * The key-encryption key (KEK) never leaves the device and is never persisted.
 * It is re-derived from a passphrase or recovery code on each unlock, and its
 * only job is to wrap and unwrap the vault key (see `vault.ts`).
 *
 * There is no separate passphrase verifier: AES-KW is authenticated, so a
 * wrong key fails to unwrap. The wrapped vault key is the verifier.
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
