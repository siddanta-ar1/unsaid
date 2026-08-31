import { z } from 'zod';
import { B64Url, Iso8601, OpaqueId } from './primitives.js';
import { CaptureType, DeletionMode, ThoughtMetadata, ThoughtWithKey } from './thought.js';
import { KdfParams, WrappedKey } from './crypto.js';

/* ---------------------------------------------------------------- identity */

/** A vault key wrapped under one way of getting in. */
export const WrappedVaultKey = z.object({ kdf: KdfParams, wrappedVaultKey: B64Url });
export type WrappedVaultKey = z.infer<typeof WrappedVaultKey>;

/**
 * Registration carries two wrapped copies of the same vault key — one under
 * the passphrase, one under the recovery code. The code itself never reaches
 * us, so we can neither reissue it nor use it.
 */
export const RegisterGuestRequest = z.object({
  passphrase: WrappedVaultKey,
  recovery: WrappedVaultKey,
  /** Derived from the vault key; stored and compared at login. */
  loginProof: B64Url,
});
export const RegisterGuestResponse = z.object({
  userId: OpaqueId,
  token: z.string(),
  expiresAt: Iso8601,
});

/**
 * Unlocking happens on the device: the client fetches the wrapped key and
 * unwraps it locally. It then proves it succeeded.
 *
 * The proof is required because a session is not read-only — it authorises
 * deleting a memory, forgetting one irreversibly, and overwriting the wrapped
 * vault key. The vault id alone cannot be the bar, since it is printed on the
 * recovery kit and shown in settings.
 */
export const LoginRequest = z.object({ userId: OpaqueId, proof: B64Url });
export const LoginResponse = RegisterGuestResponse;

/** Public unlock material. Useless without the passphrase or recovery code. */
export const UnlockMaterialResponse = z.object({
  passphrase: WrappedVaultKey,
  recovery: WrappedVaultKey,
  keyVersion: z.number().int().min(1),
});

export const SessionResponse = z.object({
  userId: OpaqueId,
  keyMaterial: z.object({ kdf: KdfParams, keyVersion: z.number().int().min(1) }),
  thoughtCount: z.number().int().nonnegative(),
  lastCaptureAt: Iso8601.nullable(),
});

/** Re-wrapping after a passphrase change or a reissued kit. */
export const RotateVaultKeyRequest = z.object({
  passphrase: WrappedVaultKey.optional(),
  recovery: WrappedVaultKey.optional(),
});
export const RotateVaultKeyResponse = z.object({ updatedAt: Iso8601 });

/* ------------------------------------------------------------ capture flow */

/**
 * Step 1 of §17.3. The client has already encrypted; it asks where to PUT the
 * bytes. No content, and no key, is sent here.
 */
export const CreateIntentRequest = z.object({
  type: CaptureType,
  byteSize: z.number().int().positive().max(64 * 1024 * 1024),
  contentHash: B64Url,
});
export const CreateIntentResponse = z.object({
  intentId: OpaqueId,
  objectId: OpaqueId,
  uploadUrl: z.url(),
  expiresAt: Iso8601,
});

/** Step 5 of §17.3: register metadata once the ciphertext is in object storage. */
export const RegisterThoughtRequest = z.object({
  intentId: OpaqueId,
  wrappedKey: WrappedKey,
  header: z.object({ v: z.number().int(), alg: z.string(), iv: B64Url }),
});
export const RegisterThoughtResponse = z.object({ thought: ThoughtMetadata });

export const ListThoughtsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['active', 'archived']).default('active'),
});
export const ListThoughtsResponse = z.object({
  thoughts: z.array(ThoughtMetadata),
  nextCursor: z.string().nullable(),
});

export const GetThoughtResponse = z.object({ thought: ThoughtWithKey });

export const DeleteThoughtRequest = z.object({ mode: DeletionMode });
export const DeleteThoughtResponse = z.object({
  id: OpaqueId,
  status: z.enum(['deleted', 'forgotten']),
  /** True once the object store confirmed removal, not merely scheduled it. */
  objectRemoved: z.boolean(),
});

/* ---------------------------------------------------------------- consents */

export const ConsentScope = z.enum([
  'ai_reflection_once',
  'ai_reflection_session',
  'ai_vault_analysis',
  'solana_anchor',
  'anonymous_share',
]);
export type ConsentScope = z.infer<typeof ConsentScope>;

export const ConsentRequest = z.object({
  scope: ConsentScope,
  version: z.number().int().min(1),
  granted: z.boolean(),
});
export const ConsentResponse = z.object({
  scope: ConsentScope,
  version: z.number().int(),
  granted: z.boolean(),
  updatedAt: Iso8601,
});

/* -------------------------------------------------------------------- echo */

/**
 * Reflection is the one path where plaintext leaves the encrypted boundary, so
 * the request carries an explicit consent token rather than relying on a stored
 * flag — the user must have just seen the disclosure sheet (§18.2).
 */
export const ReflectRequest = z.object({
  consentVersion: z.number().int().min(1),
  /** Client-decrypted content, sent for this one operation only. */
  content: z.string().min(1).max(20_000),
});
/** A crisis resource, resolved for the requester's region. */
export const CrisisResource = z.object({
  name: z.string(),
  phone: z.string().nullable(),
  url: z.string().optional(),
  hours: z.string(),
  note: z.string().optional(),
});

export const ReflectResponse = z.object({
  /** What is left of this week's budget, so the UI can warn before the wall. */
  quota: z.object({ limit: z.number().int(), remaining: z.number().int().nonnegative() }),
  reflectionId: OpaqueId,
  content: z.string(),
  modelVersion: z.string(),
  /** Set when the safety classifier routed this to the support path (§8.5). */
  safetyNotice: z.enum(['none', 'support_resources']),
  /**
   * Populated only alongside a support notice. Resolved from a region hint,
   * never from profiling — and never used to gate access to the vault.
   */
  support: z
    .object({ label: z.string(), resources: z.array(CrisisResource) })
    .nullable()
    .default(null),
});

/* ------------------------------------------------------------------ solana */

export const AnchorRequest = z.object({ ownerPubkey: z.string().min(32).max(64) });

/**
 * Everything the client needs to build the anchor transaction itself. The
 * server does not assemble or sign it — it has no wallet and no RPC in this
 * path; it only supplies the commitment it derived from the stored ciphertext
 * hash, so the client cannot anchor a value of its own choosing.
 */
export const AnchorResponse = z.object({
  commitment: B64Url,
  programId: z.string(),
  network: z.enum(['devnet', 'mainnet-beta']),
  /** 32-byte thought identifier used as a PDA seed, base64url encoded. */
  thoughtSeed: B64Url,
});

export const ConfirmAnchorRequest = z.object({ signature: z.string().min(64).max(128) });
export const ConfirmAnchorResponse = z.object({
  thoughtId: OpaqueId,
  signature: z.string(),
  status: z.enum(['confirmed', 'failed']),
});
