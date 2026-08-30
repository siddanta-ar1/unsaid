/**
 * The only place Web Crypto is called directly. Everything else in the package
 * composes these — blueprint P1: "use standard cryptography, not custom
 * algorithms" (§7).
 */

export const CONTENT_ALGORITHM = 'AES-GCM' as const;
export const CONTENT_KEY_BITS = 256;
export const IV_BYTES = 12; // 96-bit nonce: the size AES-GCM is specified for.
export const SALT_BYTES = 16;
export const PBKDF2_ITERATIONS = 600_000; // OWASP floor for PBKDF2-SHA256.

/** Resolves the platform crypto object in browsers, Node and workers alike. */
export function getCrypto(): Crypto {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error(
      'Web Crypto SubtleCrypto is unavailable. It requires a secure context (HTTPS or localhost).',
    );
  }
  return globalThis.crypto;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await getCrypto().subtle.digest('SHA-256', data as BufferSource);
  return new Uint8Array(digest);
}

/** A fresh content encryption key. One per thought, never reused. */
export function generateContentKey(): Promise<CryptoKey> {
  return getCrypto().subtle.generateKey(
    { name: CONTENT_ALGORITHM, length: CONTENT_KEY_BITS },
    true, // extractable: the CEK must be exportable so it can be wrapped.
    ['encrypt', 'decrypt'],
  );
}
