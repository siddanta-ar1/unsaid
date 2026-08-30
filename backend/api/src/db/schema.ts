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
    kdfSalt: text('kdf_salt').notNull(),
    kdfIterations: integer('kdf_iterations').notNull(),
    kdfAlgorithm: text('kdf_algorithm').notNull(),
    /** Wrapped known-constant; proves a passphrase without revealing it. */
    verifier: text('verifier').notNull(),
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
};

export type { bytea };
