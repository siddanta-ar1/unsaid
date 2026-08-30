import { z } from 'zod';
import { B64Url } from './primitives.js';

/**
 * Envelope format version. Bumped whenever the wire/at-rest layout changes.
 * Old versions must stay decryptable forever — blueprint §20.2 ("crypto formats
 * are versioned from day one").
 */
export const ENVELOPE_VERSION = 1 as const;

export const ContentAlgorithm = z.literal('AES-GCM-256');
export const WrapAlgorithm = z.literal('AES-KW-256');
export const KdfAlgorithm = z.literal('PBKDF2-SHA256');

/**
 * Header travelling alongside ciphertext. Contains no plaintext-derived data:
 * a header leak reveals only sizes and algorithm choices.
 */
export const EnvelopeHeader = z.object({
  v: z.literal(ENVELOPE_VERSION),
  alg: ContentAlgorithm,
  /** 12-byte GCM nonce, unique per encryption operation. */
  iv: B64Url,
});
export type EnvelopeHeader = z.infer<typeof EnvelopeHeader>;

/** A content encryption key (CEK) wrapped under the user's key-encryption key. */
export const WrappedKey = z.object({
  v: z.literal(ENVELOPE_VERSION),
  alg: WrapAlgorithm,
  /** Which KEK generation wrapped this CEK; enables rotation without rewrites. */
  keyVersion: z.number().int().min(1),
  wrapped: B64Url,
});
export type WrappedKey = z.infer<typeof WrappedKey>;

/** Parameters needed to re-derive a KEK from a passphrase. Safe to store. */
export const KdfParams = z.object({
  v: z.literal(ENVELOPE_VERSION),
  alg: KdfAlgorithm,
  salt: B64Url,
  iterations: z.number().int().min(600_000),
});
export type KdfParams = z.infer<typeof KdfParams>;
