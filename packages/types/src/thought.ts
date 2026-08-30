import { z } from 'zod';
import { B64Url, Iso8601, OpaqueId } from './primitives.js';
import { KdfParams, WrappedKey } from './crypto.js';

export const CaptureType = z.enum(['text', 'audio']);
export type CaptureType = z.infer<typeof CaptureType>;

/**
 * Lifecycle states. `deleted` and `forgotten` are distinct on purpose (§12.4):
 * deleted removes the record and object; forgotten destroys the wrapped key so
 * the ciphertext becomes undecryptable even if a copy survives somewhere.
 */
export const ThoughtStatus = z.enum(['active', 'archived', 'deleted', 'forgotten']);
export type ThoughtStatus = z.infer<typeof ThoughtStatus>;

export const DeletionMode = z.enum(['local_discard', 'cloud_delete', 'forget']);
export type DeletionMode = z.infer<typeof DeletionMode>;

/**
 * Everything the server is allowed to know about a thought.
 * Notably absent: title, transcript, tags, mood — all of those live inside the
 * ciphertext. The server can order a timeline and nothing more.
 */
export const ThoughtMetadata = z.object({
  id: OpaqueId,
  type: CaptureType,
  status: ThoughtStatus,
  /** SHA-256 of the ciphertext — integrity only, reveals nothing about content. */
  contentHash: B64Url,
  encryptionVersion: z.number().int().min(1),
  byteSize: z.number().int().nonnegative(),
  createdAt: Iso8601,
  updatedAt: Iso8601,
  /** Present only once the user has chosen to anchor it on Solana. */
  anchored: z.boolean(),
});
export type ThoughtMetadata = z.infer<typeof ThoughtMetadata>;

/** The full payload a client needs to decrypt one thought. */
export const ThoughtWithKey = ThoughtMetadata.extend({
  wrappedKey: WrappedKey,
  header: z.object({ v: z.number().int(), alg: z.string(), iv: B64Url }),
  downloadUrl: z.url(),
  downloadExpiresAt: Iso8601,
});
export type ThoughtWithKey = z.infer<typeof ThoughtWithKey>;

/**
 * How a vault key is stored for one way of getting in. There is no separate
 * verifier: AES-KW is authenticated, so a wrong passphrase or recovery code
 * simply fails to unwrap.
 */
export const VaultKeyMaterial = z.object({
  kdf: KdfParams,
  wrappedVaultKey: B64Url,
  keyVersion: z.number().int().min(1),
});
export type VaultKeyMaterial = z.infer<typeof VaultKeyMaterial>;
