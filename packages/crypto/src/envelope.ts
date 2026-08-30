import {
  ENVELOPE_VERSION,
  type EnvelopeHeader,
  type WrappedKey,
} from '@unsaid/types';
import { decodeUtf8, encodeUtf8, fromBase64Url, toBase64Url } from './encoding.js';
import {
  CONTENT_ALGORITHM,
  CONTENT_KEY_BITS,
  IV_BYTES,
  generateContentKey,
  getCrypto,
  randomBytes,
  sha256,
} from './primitives.js';

/**
 * An encrypted thought, ready to leave the device.
 *
 * The three parts travel to three different places: `ciphertext` to object
 * storage, `wrappedKey` and `header` to Postgres. A leak of any one of them in
 * isolation yields nothing.
 */
export interface SealedContent {
  ciphertext: Uint8Array;
  header: EnvelopeHeader;
  wrappedKey: WrappedKey;
  /** SHA-256 of the ciphertext, for integrity checks on download. */
  contentHash: string;
}

export class CryptoVersionError extends Error {
  constructor(readonly version: number) {
    super(`Unsupported envelope version ${version}; this client supports ${ENVELOPE_VERSION}.`);
    this.name = 'CryptoVersionError';
  }
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * Encrypts one thought under a fresh content key, then wraps that key with the
 * user's KEK. Called on the device before anything crosses the network.
 */
export async function seal(
  plaintext: Uint8Array,
  kek: CryptoKey,
  keyVersion: number,
): Promise<SealedContent> {
  const subtle = getCrypto().subtle;
  const cek = await generateContentKey();
  const iv = randomBytes(IV_BYTES);

  const encrypted = await subtle.encrypt(
    { name: CONTENT_ALGORITHM, iv: iv as BufferSource },
    cek,
    plaintext as BufferSource,
  );
  const ciphertext = new Uint8Array(encrypted);

  const wrapped = await subtle.wrapKey('raw', cek, kek, 'AES-KW');

  return {
    ciphertext,
    header: { v: ENVELOPE_VERSION, alg: 'AES-GCM-256', iv: toBase64Url(iv) },
    wrappedKey: {
      v: ENVELOPE_VERSION,
      alg: 'AES-KW-256',
      keyVersion,
      wrapped: toBase64Url(new Uint8Array(wrapped)),
    },
    contentHash: toBase64Url(await sha256(ciphertext)),
  };
}

export async function open(
  ciphertext: Uint8Array,
  header: EnvelopeHeader,
  wrappedKey: WrappedKey,
  kek: CryptoKey,
): Promise<Uint8Array> {
  if (header.v !== ENVELOPE_VERSION) throw new CryptoVersionError(header.v);
  if (wrappedKey.v !== ENVELOPE_VERSION) throw new CryptoVersionError(wrappedKey.v);

  const subtle = getCrypto().subtle;

  let cek: CryptoKey;
  try {
    cek = await subtle.unwrapKey(
      'raw',
      fromBase64Url(wrappedKey.wrapped) as BufferSource,
      kek,
      'AES-KW',
      { name: CONTENT_ALGORITHM, length: CONTENT_KEY_BITS },
      false,
      ['decrypt'],
    );
  } catch {
    throw new DecryptionError('Could not unwrap the content key — wrong vault key or key version.');
  }

  try {
    const decrypted = await subtle.decrypt(
      { name: CONTENT_ALGORITHM, iv: fromBase64Url(header.iv) as BufferSource },
      cek,
      ciphertext as BufferSource,
    );
    return new Uint8Array(decrypted);
  } catch {
    // GCM authentication failed: the ciphertext or IV was altered.
    throw new DecryptionError('Content failed its integrity check and was not decrypted.');
  }
}

export async function sealText(
  text: string,
  kek: CryptoKey,
  keyVersion: number,
): Promise<SealedContent> {
  return seal(encodeUtf8(text), kek, keyVersion);
}

export async function openText(
  ciphertext: Uint8Array,
  header: EnvelopeHeader,
  wrappedKey: WrappedKey,
  kek: CryptoKey,
): Promise<string> {
  return decodeUtf8(await open(ciphertext, header, wrappedKey, kek));
}

/**
 * Re-wraps a content key under a new KEK without touching the ciphertext.
 * This is what makes key rotation cheap: only a few hundred bytes per thought
 * change, and historical objects are never rewritten (§12.3).
 */
export async function rewrapKey(
  wrappedKey: WrappedKey,
  oldKek: CryptoKey,
  newKek: CryptoKey,
  newKeyVersion: number,
): Promise<WrappedKey> {
  const subtle = getCrypto().subtle;
  const cek = await subtle.unwrapKey(
    'raw',
    fromBase64Url(wrappedKey.wrapped) as BufferSource,
    oldKek,
    'AES-KW',
    { name: CONTENT_ALGORITHM, length: CONTENT_KEY_BITS },
    true,
    ['decrypt'],
  );
  const rewrapped = await subtle.wrapKey('raw', cek, newKek, 'AES-KW');
  return {
    v: ENVELOPE_VERSION,
    alg: 'AES-KW-256',
    keyVersion: newKeyVersion,
    wrapped: toBase64Url(new Uint8Array(rewrapped)),
  };
}

/** The commitment anchored on Solana: a hash, never the content itself (§14.3). */
export async function computeCommitment(contentHash: string, thoughtId: string): Promise<string> {
  const input = encodeUtf8(`unsaid:v1:${thoughtId}:${contentHash}`);
  return toBase64Url(await sha256(input));
}

/**
 * The 32-byte PDA seed for a thought.
 *
 * Deliberately not the raw thought id. PDA seeds are recoverable from public
 * chain data, so using the application id directly would let an observer who
 * ever sees one of our identifiers link it to on-chain activity. A domain-
 * separated digest keeps the derivation deterministic without carrying that
 * identifier on chain (§13.2, blockchain observer).
 */
export async function deriveThoughtSeed(thoughtId: string): Promise<string> {
  return toBase64Url(await sha256(encodeUtf8(`unsaid:seed:v1:${thoughtId}`)));
}
