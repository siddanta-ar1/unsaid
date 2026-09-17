import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Postgres schema. Blueprint §16.
 *
 * The governing rule: there is no column anywhere in this file that can hold
 * emotional content. No `title`, no `transcript`, no `body`, no `tags`. If a
 * future migration adds one, the privacy regression test in
 * `tests/privacy` should fail before it ships.
 */

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * SHA-256 of the KDF salt. Lets a returning user find their account without
     * the server ever holding an email address or the passphrase itself.
     */
    accountLookup: text('account_lookup').notNull(),

    /*
     * One vault key, wrapped once per way in. The server holds only wrapped
     * copies: two locked boxes tell it nothing one would not have.
     *
     * No separate verifier column is needed — AES-KW is authenticated, so a
     * wrong passphrase fails to unwrap. The wrapped key *is* the verifier.
     */
    kdfSalt: text('kdf_salt').notNull(),
    kdfIterations: integer('kdf_iterations').notNull(),
    kdfAlgorithm: text('kdf_algorithm').notNull(),
    wrappedVaultKey: text('wrapped_vault_key').notNull(),

    /** The recovery kit: a second wrapped copy of the same vault key. */
    recoverySalt: text('recovery_salt').notNull(),
    recoveryIterations: integer('recovery_iterations').notNull(),
    recoveryAlgorithm: text('recovery_algorithm').notNull(),
    recoveryWrappedVaultKey: text('recovery_wrapped_vault_key').notNull(),
    recoveryIssuedAt: timestamp('recovery_issued_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Proof that a caller holds the vault key, compared at login.
     *
     * Nullable only so the column could be added without a rewrite; the login
     * route treats a null as "cannot authenticate" rather than "skip the
     * check", so the failure direction is closed.
     */
    loginProof: text('login_proof'),

    /**
     * Bumped whenever existing sessions must stop working — today, changing a
     * passphrase or reissuing a recovery kit. Tokens carry the epoch they were
     * issued under, so an old one is rejected without any server-side session
     * store to maintain.
     */
    sessionEpoch: integer('session_epoch').notNull().default(1),

    keyVersion: smallint('key_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_account_lookup_idx').on(t.accountLookup)],
);

export const objects = pgTable('objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Opaque storage path; never contains a user id, wallet or email (§16.3). */
  objectKey: text('object_key').notNull().unique(),
  bucket: text('bucket').notNull(),
  provider: text('provider').notNull().default('s3'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  checksum: text('checksum').notNull(),
  uploaded: boolean('uploaded').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const thoughts = pgTable(
  'thoughts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
    type: text('type', { enum: ['text', 'audio'] }).notNull(),
    status: text('status', { enum: ['active', 'archived', 'deleted', 'forgotten'] })
      .notNull()
      .default('active'),
    contentHash: text('content_hash').notNull(),
    encryptionVersion: smallint('encryption_version').notNull(),
    /** AES-GCM nonce. Public by design — useless without the content key. */
    iv: text('iv').notNull(),
    algorithm: text('algorithm').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // Vault timeline: newest first, scoped to one owner.
    index('thoughts_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
);

/**
 * Split from `thoughts` on purpose. "Forget" is implemented as deleting the row
 * here (§12.4): the ciphertext may survive in a backup, but with no wrapped key
 * there is no path back to the content encryption key.
 */
export const contentKeys = pgTable('content_keys', {
  thoughtId: uuid('thought_id')
    .primaryKey()
    .references(() => thoughts.id, { onDelete: 'cascade' }),
  wrappedKey: text('wrapped_key').notNull(),
  wrapAlgorithm: text('wrap_algorithm').notNull(),
  keyVersion: smallint('key_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Short-lived upload reservations. Rows are pruned once claimed or expired. */
export const uploadIntents = pgTable(
  'upload_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objects.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['text', 'audio'] }).notNull(),
    declaredSize: bigint('declared_size', { mode: 'number' }).notNull(),
    declaredHash: text('declared_hash').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('upload_intents_user_idx').on(t.userId)],
);

/** Encrypted Echo output. Stored exactly like a thought — never as plaintext. */
export const reflections = pgTable('reflections', {
  id: uuid('id').primaryKey().defaultRandom(),
  thoughtId: uuid('thought_id')
    .notNull()
    .references(() => thoughts.id, { onDelete: 'cascade' }),
  objectId: uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  /** Provider and model identifier only — never the prompt or response (§18.4). */
  providerRef: text('provider_ref').notNull(),
  modelVersion: text('model_version').notNull(),
  safetyNotice: text('safety_notice', { enum: ['none', 'support_resources'] })
    .notNull()
    .default('none'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const solanaRecords = pgTable(
  'solana_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    thoughtId: uuid('thought_id')
      .notNull()
      .references(() => thoughts.id, { onDelete: 'cascade' }),
    network: text('network', { enum: ['devnet', 'mainnet-beta'] }).notNull(),
    programId: text('program_id').notNull(),
    accountAddress: text('account_address'),
    commitment: text('commitment').notNull(),
    txSignature: text('tx_signature'),
    status: text('status', { enum: ['pending', 'confirmed', 'failed'] })
      .notNull()
      .default('pending'),
    /** Makes retried submissions converge on one record (§7 P1, D-03). */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('solana_records_idempotency_idx').on(t.idempotencyKey),
    index('solana_records_thought_idx').on(t.thoughtId),
  ],
);

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    version: integer('version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('consents_user_scope_idx').on(t.userId, t.scope)],
);

/** Operational audit trail. Subjects are ids; there is no content column. */
export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    subjectId: uuid('subject_id'),
    actorType: text('actor_type', { enum: ['user', 'system', 'admin'] }).notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('security_events_subject_idx').on(t.subjectId, t.createdAt.desc())],
);

/**
 * Analytics events. Blueprint §31.1 and §25.3.
 *
 * Keyed by a rotating cohort key rather than a user id, so the funnel can be
 * counted without building a per-person record of when someone felt bad enough
 * to write. `properties` only ever holds the bucketed values the strict event
 * union permits — an undeclared field is rejected before it reaches here.
 */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cohortKey: text('cohort_key').notNull(),
    name: text('name').notNull(),
    properties: text('properties').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('analytics_events_name_created_idx').on(t.name, t.createdAt.desc())],
);

/**
 * In-app feedback. The one place a user may deliberately write to us knowing a
 * human reads it — which is why `message` exists here and nowhere else, and why
 * the UI says so plainly before they type.
 */
export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  screen: text('screen').notNull(),
  sentiment: text('sentiment').notNull(),
  message: text('message'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The waitlist. The only table in this system that holds an email address, and
 * it is deliberately unconnected to any vault — signing up here tells us
 * nothing about what anyone writes, and a vault owner is not discoverable from
 * their address.
 */
export const waitlist = pgTable(
  'waitlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('waitlist_email_idx').on(t.email)],
);

/**
 * Our copy of what was written to the consent ledger.
 *
 * The chain is the record; this is the outbox. It exists so that a receipt we
 * failed to send is visible as `pending` rather than absent — a log that
 * quietly omits the accesses it could not record would be worse than no log,
 * because it would look complete.
 *
 * Note what is not here: no prompt, no reflection, no subject that could be
 * read back to a person. `resultHash` is salted by the reflection id, so it can
 * be recomputed by whoever holds the answer and by nobody else.
 */
export const consentReceipts = pgTable(
  'consent_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    thoughtId: uuid('thought_id')
      .notNull()
      .references(() => thoughts.id, { onDelete: 'cascade' }),
    /** The PDA seed, 32 bytes base64url. Also what makes a retry idempotent. */
    receiptId: text('receipt_id').notNull(),
    purpose: text('purpose', {
      enum: ['reflection', 'reflection_unattested', 'export', 'share'],
    }).notNull(),
    consentVersion: integer('consent_version').notNull(),
    /** Null where nothing could prove what ran, which is itself the record. */
    attestation: text('attestation'),
    resultHash: text('result_hash').notNull(),
    network: text('network', { enum: ['devnet', 'mainnet-beta'] }).notNull(),
    programId: text('program_id').notNull(),
    accountAddress: text('account_address'),
    txSignature: text('tx_signature'),
    status: text('status', { enum: ['pending', 'confirmed', 'failed'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('consent_receipts_receipt_idx').on(t.receiptId),
    index('consent_receipts_user_idx').on(t.userId, t.createdAt),
  ],
);

export const schema = {
  users,
  objects,
  thoughts,
  contentKeys,
  uploadIntents,
  reflections,
  solanaRecords,
  consents,
  securityEvents,
  analyticsEvents,
  feedback,
  waitlist,
  consentReceipts,
};

export type { bytea };
